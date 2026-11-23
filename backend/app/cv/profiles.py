"""Multi-profile manager, legacy migration, and generic sample CV provider."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
import yaml

from backend.app.config import get_settings, reload_settings
from backend.app.settings_store import save_stored_settings

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
LEGACY_PROFILE_DIR = REPO_ROOT / "profile"
LEGACY_BASELINE_DIR = REPO_ROOT / "data" / "baseline"


def get_profiles_root() -> Path:
    """Return <data_dir>/profiles/ directory."""
    root = get_settings().data_dir / "profiles"
    root.mkdir(parents=True, exist_ok=True)
    return root


def slugify_profile_id(name: str) -> str:
    """Create a filesystem-safe slug ID from a profile name."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug or "profile"


def _read_yaml_name(yaml_path: Path) -> str | None:
    if not yaml_path.exists():
        return None
    try:
        data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
        name = data.get("cv", {}).get("name")
        return str(name).strip() if name else None
    except Exception:
        return None


def migrate_legacy_profile_if_needed() -> None:
    """Auto-migrate repo-root profile/ into <data_dir>/profiles/local-default/ once if present."""
    profiles_root = get_profiles_root()
    # Skip if any profile already exists
    if any(p.is_dir() and (p / "meta.json").exists() for p in profiles_root.iterdir()):
        return

    has_legacy = (
        (LEGACY_PROFILE_DIR / "master.en.yaml").exists()
        or (LEGACY_PROFILE_DIR / "master.fr.yaml").exists()
    )
    if not has_legacy:
        return

    dest_dir = profiles_root / "local-default"
    dest_dir.mkdir(parents=True, exist_ok=True)

    for fname in ("master.en.yaml", "master.fr.yaml", "career_goals.json"):
        src = LEGACY_PROFILE_DIR / fname
        if src.exists() and not (dest_dir / fname).exists():
            shutil.copy2(src, dest_dir / fname)

    baseline_dest = dest_dir / "baseline"
    baseline_dest.mkdir(parents=True, exist_ok=True)
    if LEGACY_BASELINE_DIR.exists():
        for lang_upper in ("EN", "FR"):
            for ext in ("pdf", "png"):
                new_src = LEGACY_BASELINE_DIR / f"baseline_CV_{lang_upper}.{ext}"
                if new_src.exists() and not (baseline_dest / new_src.name).exists():
                    shutil.copy2(new_src, baseline_dest / new_src.name)

    display_name = (
        _read_yaml_name(dest_dir / "master.en.yaml")
        or _read_yaml_name(dest_dir / "master.fr.yaml")
        or "Default Profile"
    )
    meta = {
        "id": "local-default",
        "name": display_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (dest_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def get_active_profile_id() -> str:
    """Return currently active profile ID (falls back to 'local-default')."""
    migrate_legacy_profile_if_needed()
    return get_settings().active_profile_id or "local-default"


def get_active_profile_dir(profile_id: str | None = None) -> Path:
    """Return directory for the active (or specified) profile, ensuring it exists."""
    migrate_legacy_profile_if_needed()
    pid = profile_id or get_active_profile_id()
    pdir = get_profiles_root() / pid
    pdir.mkdir(parents=True, exist_ok=True)
    meta_file = pdir / "meta.json"
    if not meta_file.exists():
        # Only auto-create meta.json if directory already has YAML files or is actively used
        if (pdir / "master.en.yaml").exists() or (pdir / "master.fr.yaml").exists():
            name = (
                _read_yaml_name(pdir / "master.en.yaml")
                or _read_yaml_name(pdir / "master.fr.yaml")
                or pid
            )
            meta_file.write_text(
                json.dumps(
                    {
                        "id": pid,
                        "name": name,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
    return pdir


def get_active_baseline_dir(profile_id: str | None = None) -> Path:
    """Return baseline PDF/PNG directory for active (or specified) profile."""
    bdir = get_active_profile_dir(profile_id) / "baseline"
    bdir.mkdir(parents=True, exist_ok=True)
    return bdir


def get_baseline_url_prefix(profile_id: str | None = None) -> str:
    """Return static /data/... URL prefix for active profile baseline assets."""
    pid = profile_id or get_active_profile_id()
    return f"/data/profiles/{pid}/baseline"


def get_available_languages(profile_dir: Path | None = None) -> list[str]:
    """Return list of languages ('en', 'fr') that have a master.<lang>.yaml file."""
    pdir = profile_dir or get_active_profile_dir()
    langs: list[str] = []
    for code in ("en", "fr"):
        if (pdir / f"master.{code}.yaml").exists():
            langs.append(code)
    return langs


def list_profiles() -> list[dict[str, Any]]:
    """List all saved profiles under <data_dir>/profiles/."""
    migrate_legacy_profile_if_needed()
    root = get_profiles_root()
    active_id = get_active_profile_id()
    profiles: list[dict[str, Any]] = []

    for pdir in sorted(root.iterdir()):
        if not pdir.is_dir():
            continue
        meta_path = pdir / "meta.json"
        has_yaml = (pdir / "master.en.yaml").exists() or (pdir / "master.fr.yaml").exists()
        if not meta_path.exists() and not has_yaml:
            continue
        meta: dict[str, Any] = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        pid = pdir.name
        display_name = (
            _read_yaml_name(pdir / "master.en.yaml")
            or _read_yaml_name(pdir / "master.fr.yaml")
            or meta.get("name")
            or pid
        )
        profiles.append(
            {
                "id": pid,
                "name": display_name,
                "is_active": pid == active_id,
                "languages": get_available_languages(pdir),
                "created_at": meta.get("created_at"),
            }
        )

    return profiles


def create_profile(name: str, profile_id: str | None = None, activate: bool = True) -> dict[str, Any]:
    """Create a new empty profile directory and optionally activate it."""
    migrate_legacy_profile_if_needed()
    root = get_profiles_root()
    base_slug = slugify_profile_id(profile_id or name)
    pid = base_slug
    counter = 2
    while (root / pid).exists() and ((root / pid / "meta.json").exists() or get_available_languages(root / pid)):
        pid = f"{base_slug}-{counter}"
        counter += 1

    pdir = root / pid
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "baseline").mkdir(parents=True, exist_ok=True)
    meta = {
        "id": pid,
        "name": name.strip() or pid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (pdir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if activate:
        activate_profile(pid)

    return {
        "id": pid,
        "name": meta["name"],
        "is_active": activate,
        "languages": [],
        "created_at": meta["created_at"],
    }


def _resolve_profile_path(profile_id: str) -> Path:
    """Validate profile_id and return its resolved directory safely inside profiles/."""
    pid = (profile_id or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", pid):
        raise ValueError(f"Invalid profile_id '{profile_id}'")
    root = get_profiles_root().resolve()
    pdir = (root / pid).resolve()
    if pdir.parent != root:
        raise ValueError(f"Invalid profile_id '{profile_id}'")
    return pdir


def activate_profile(profile_id: str) -> dict[str, Any]:
    """Switch active_profile_id in settings.json and reload runtime settings."""
    migrate_legacy_profile_if_needed()
    pdir = _resolve_profile_path(profile_id)
    if not pdir.exists():
        raise FileNotFoundError(f"Profile '{profile_id}' not found")
    cfg = get_settings()
    save_stored_settings(cfg.data_dir, {"active_profile_id": profile_id})
    reload_settings()
    name = (
        _read_yaml_name(pdir / "master.en.yaml")
        or _read_yaml_name(pdir / "master.fr.yaml")
        or profile_id
    )
    return {
        "id": profile_id,
        "name": name,
        "is_active": True,
        "languages": get_available_languages(pdir),
    }


def delete_profile(profile_id: str) -> None:
    """Delete a non-active (or fallback-reassigned) profile directory."""
    migrate_legacy_profile_if_needed()
    pdir = _resolve_profile_path(profile_id)
    if not pdir.exists():
        raise FileNotFoundError(f"Profile '{profile_id}' not found")

    all_profiles = list_profiles()
    if len(all_profiles) <= 1:
        raise ValueError("Cannot delete the last remaining profile.")

    if get_active_profile_id() == profile_id:
        fallback = next(p for p in all_profiles if p["id"] != profile_id)
        activate_profile(fallback["id"])

    shutil.rmtree(pdir, ignore_errors=True)


def get_sample_profile(lang: Literal["en", "fr"] = "en") -> dict[str, Any]:
    """Return a clean, generic sample CandidateProfile payload for onboarding/demo."""
    is_fr = lang == "fr"
    return {
        "language": lang,
        "basics": {
            "name": "Amine Ben Ali",
            "first_name": "Amine",
            "last_name": "Ben Ali",
            "email": "amine.benali@example.edu",
            "phone": "+216 20 000 000",
            "location": "Tunis, Tunisie" if is_fr else "Tunis, Tunisia",
            "linkedin": "amine-benali-demo",
            "github": "amine-benali-demo",
            "website": None,
            "institution": "ENSI / INSAT" if is_fr else "Engineering School / University",
            "degree": "Cycle Ingénieur en Informatique" if is_fr else "Master's / Engineering Degree in Computer Science",
            "availability": "PFE 2027 (Février 2027 / 4–6 mois)" if is_fr else "PFE 2027 (Starting February 2027 / 4-6 months)",
        },
        "career_goals": {
            "target_roles": "Software Engineer, AI/ML Engineer, Data Engineer, Cloud & DevOps",
            "tech_to_learn": "Kubernetes, Apache Spark, LangGraph, Terraform, MLOps",
            "dealbreakers": "Pure manual data entry, WordPress-only sites, non-technical support",
            "pfe_priorities": "Production engineering depth, measurable results for PFE defense, pre-hiring potential",
        },
        "headline": (
            "Ingénierie Logicielle, Data & IA | Étudiant PFE 2027"
            if is_fr
            else "Software, Data & AI Engineering | PFE 2027 Candidate"
        ),
        "summary": "",
        "work_experience": [
            {
                "company": "TechFlow Solutions",
                "position": "Stagiaire Ingénieur Backend & Data" if is_fr else "Software & Data Engineering Intern",
                "start_date": "2025-06",
                "end_date": "2025-08",
                "location": "Tunis, Tunisie" if is_fr else "Tunis, Tunisia",
                "highlights": [
                    (
                        "Conçu une API REST **FastAPI** + **PostgreSQL** traitant **15 000+ requêtes/jour** avec un temps de réponse P95 inférieur à **45 ms**."
                        if is_fr
                        else "Built a **FastAPI** + **PostgreSQL** REST service handling **15,000+ daily requests** with **<45ms P95 latency**."
                    ),
                    (
                        "Automatisé des pipelines ETL **Python** et **Docker**, réduisant le temps de préparation des données de **35 %**."
                        if is_fr
                        else "Automated **Python** and **Docker** ETL pipelines, cutting weekly data preparation time by **35%**."
                    ),
                ],
            }
        ],
        "projects": [
            {
                "name": "DocQuery RAG Assistant",
                "date": "2025",
                "url": None,
                "highlights": [
                    (
                        "Développé un assistant RAG (**Python**, **FAISS**, **React**) indexant **1 200+ documents PDF** avec recherche hybride sémantique et lexicale."
                        if is_fr
                        else "Built a document RAG assistant (**Python**, **FAISS**, **React**) indexing **1,200+ PDFs** with hybrid semantic and keyword retrieval."
                    ),
                ],
            }
        ],
        "education": [
            {
                "institution": "École Nationale des Sciences de l'Informatique (ENSI)" if is_fr else "National School of Computer Science",
                "degree": "Cycle Ingénieur" if is_fr else "Engineering Degree",
                "area": "Informatique & Science des Données" if is_fr else "Computer Science & Data Engineering",
                "start_date": "2024-09",
                "end_date": "2027-06" if is_fr else "present",
                "location": "Tunis, Tunisie" if is_fr else "Tunis, Tunisia",
                "highlights": [],
            }
        ],
        "skills": [
            {
                "label": "Langages & Backend" if is_fr else "Languages & Backend",
                "details": "Python, TypeScript, SQL, FastAPI, PostgreSQL, Docker, Git",
            },
            {
                "label": "Data & IA" if is_fr else "Data & AI",
                "details": "PyTorch, scikit-learn, Pandas, FAISS, RAG, REST APIs",
            },
        ],
        "certifications": [],
        "extracurricular": [],
    }
