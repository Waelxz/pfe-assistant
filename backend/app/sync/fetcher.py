"""Fetch 2026-2027 PFE Book listings from pfebooks.com WordPress REST API."""

import html
import re
from datetime import datetime, timezone
import bs4
import httpx
from pydantic import BaseModel, Field

CATEGORY_MAP = {
    "business-marketing-rh": "Business, Marketing & RH",
    "durabilite-technologie-verte": "Durabilité & Technologie Verte",
    "industrie-ingenierie-btp": "Industrie, Ingénierie & BTP",
    "informatique-ia-data": "Informatique, IA & Données",
    "systemes-reseaux-cloud": "Systèmes, Réseaux & Cloud",
    "web-mobile-design": "Web, Mobile & Design (UX/UI)",
}

TUNISIAN_CITIES = [
    "Tunis", "Ariana", "La Soukra", "Soukra", "Ben Arous", "Manouba", "Lac 1", "Lac 2",
    "Berges du Lac", "Les Berges du Lac", "Sfax", "Sousse", "Monastir", "Mahdia", "Nabeul",
    "Hammamet", "Bizerte", "Gabes", "Kairouan", "El Ghazala", "Ghazela", "Ennasr", "Menzah",
    "Centre Urbain Nord", "Megrine", "Rades", "Kasserine", "Gafsa", "Medenine", "Zarzis",
    "Tataouine", "Beja", "Jendouba", "Siliana", "Kef", "Tozeur", "Kebili", "Zaghouan",
]


class FetchedListing(BaseModel):
    wp_post_id: int
    slug: str
    company_name: str
    post_url: str
    published_at: datetime | None = None
    modified_at: datetime | None = None
    catalogue_term: str = "2026-2027"
    categories: list[int] = Field(default_factory=list)
    tags: list[int] = Field(default_factory=list)
    category_names: list[str] = Field(default_factory=list)
    tag_names: list[str] = Field(default_factory=list)
    description_html: str = ""
    description_text: str = ""
    pdf_url: str | None = None
    location: str | None = None
    deadline: str | None = None
    apply_method: str | None = None
    email: str | None = None
    external_url: str | None = None
    subject_count: int = 0
    subjects_preview: list[dict] = Field(default_factory=list)


def extract_pdf_url(html_content: str) -> str | None:
    """Extract PFE Book PDF URL from post content HTML."""
    if not html_content:
        return None

    soup = bs4.BeautifulSoup(html_content, "html.parser")

    # Priority 1: <a> tag with pdfemb-viewer class or ending in .pdf
    for a in soup.find_all("a"):
        href = a.get("href", "").strip()
        classes = a.get("class") or []
        if href.lower().endswith(".pdf") or "pdfemb-viewer" in classes:
            return href

    # Priority 2: regex match for pdf in content
    match = re.search(r"https?://[^\s\"\'<>]+\.pdf", html_content, re.IGNORECASE)
    if match:
        return match.group(0).strip()

    # Priority 3: pfebook-layout viewer tag with data-src
    viewer = soup.find(class_="pfeb-viewer")
    if viewer and viewer.get("data-src"):
        return viewer["data-src"].strip()

    match_src = re.search(r'data-src=[\"\'](https?://[^\"\']+)[\"\']', html_content)
    if match_src:
        return match_src.group(1).strip()

    return None


def strip_bonus_section(html_content: str) -> str:
    """Strip generic <h2>Bonus</h2> section (CV / cover letter guides) from post HTML."""
    if not html_content:
        return ""
    soup = bs4.BeautifulSoup(html_content, "html.parser")
    for h2 in soup.find_all(["h2", "h3"]):
        if "bonus" in h2.get_text(strip=True).lower():
            # Remove this heading and subsequent elements until next heading
            curr = h2
            to_remove = [curr]
            sib = curr.next_sibling
            while sib and getattr(sib, "name", None) not in ["h2", "h3"]:
                next_sib = sib.next_sibling
                to_remove.append(sib)
                sib = next_sib
            for el in to_remove:
                if hasattr(el, "decompose"):
                    el.decompose()
                elif hasattr(el, "extract"):
                    el.extract()
    return str(soup)


def clean_html_text(html_content: str) -> str:
    """Extract plain text from HTML, stripping navigation/tags and bonus guides."""
    if not html_content:
        return ""
    cleaned = strip_bonus_section(html_content)
    soup = bs4.BeautifulSoup(cleaned, "html.parser")
    # Remove script, style tags
    for tag in soup(["script", "style", "nav", "footer", "aside"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    # Clean excessive whitespace
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def parse_class_list_taxonomies(class_list: list[str]) -> tuple[list[str], list[str]]:
    """Extract human-readable domain categories and tech tags from WordPress class_list."""
    category_names: list[str] = []
    tag_names: list[str] = []

    for c in class_list:
        if c.startswith("category-"):
            slug = c[len("category-"):]
            name = CATEGORY_MAP.get(slug, slug.replace("-", " ").title())
            if name not in category_names:
                category_names.append(name)
        elif c.startswith("tag-"):
            tag_slug = c[len("tag-"):]
            clean_tag = re.sub(r"-\d+$", "", tag_slug).replace("-", " ")
            if clean_tag not in tag_names:
                tag_names.append(clean_tag)

    return category_names, tag_names


def parse_html_sections(html_content: str) -> dict:
    """Zero-cost parser extracting structured hints from standardized 7-section HTML."""
    if not html_content:
        return {
            "location": None,
            "deadline": None,
            "apply_method": None,
            "email": None,
            "external_url": None,
            "subject_count": 0,
            "subjects_preview": [],
        }

    soup = bs4.BeautifulSoup(html_content, "html.parser")
    res = {
        "location": None,
        "deadline": None,
        "apply_method": None,
        "email": None,
        "external_url": None,
        "subject_count": 0,
        "subjects_preview": [],
    }

    # 1. Subjects section
    for h2 in soup.find_all(["h2", "h3"]):
        title = h2.get_text(strip=True).lower()
        if any(w in title for w in ["stage", "sujet"]):
            sib = h2.find_next_sibling()
            while sib and sib.name not in ["h2", "h3"]:
                if sib.name == "ul":
                    for li in sib.find_all("li"):
                        text = li.get_text(" ", strip=True)
                        link = li.find("a")
                        apply_url = link.get("href") if link else None
                        res["subjects_preview"].append({"title": text, "apply_url": apply_url})
                sib = sib.find_next_sibling()
            res["subject_count"] = len(res["subjects_preview"])

        elif any(w in title for w in ["coordonn", "candidature", "postuler", "contact"]):
            sib = h2.find_next_sibling()
            while sib and sib.name not in ["h2", "h3"]:
                text = sib.get_text(" ", strip=True)
                if "adresse :" in text.lower():
                    m = re.search(r"Adresse\s*:\s*([^,\n\r]+(?:,\s*[^,\n\r]+)?)", text, re.I)
                    if m:
                        res["location"] = m.group(1).strip()
                if "adresse email :" in text.lower() or "email :" in text.lower():
                    m = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", text)
                    if m:
                        res["email"] = m.group(0)
                if "site web :" in text.lower():
                    link = sib.find("a")
                    if link and link.get("href"):
                        res["external_url"] = link.get("href")
                    else:
                        m = re.search(r"Site\s*web\s*:\s*([^\s]+)", text, re.I)
                        if m:
                            res["external_url"] = m.group(1).strip()
                if "date limite" in text.lower():
                    m = re.search(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", text)
                    if m:
                        res["deadline"] = m.group(1)
                sib = sib.find_next_sibling()

    # 2. Location fallback via city detection if "Adresse :" was absent
    if not res["location"]:
        all_text = soup.get_text(" ", strip=True)
        city_pattern = r"\b(?:à|a|au|aux|basé à|basée à|situé à|située à)\s+(" + "|".join(re.escape(c) for c in TUNISIAN_CITIES) + r")\b"
        m_city = re.search(city_pattern, all_text, re.I)
        if m_city:
            res["location"] = m_city.group(1).strip()

    # 3. Determine provisional apply_method
    if res["external_url"] and not res["email"]:
        res["apply_method"] = "form"
    elif res["email"]:
        res["apply_method"] = "email"
    elif res["external_url"]:
        res["apply_method"] = "form"

    return res


class PfebooksFetcher:
    """Async client to fetch eligible listings from pfebooks.com."""

    def __init__(
        self,
        base_url: str = "https://pfebooks.com/wp-json/wp/v2",
        timeout: float = 20.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def fetch_eligible_listings(
        self, min_date_iso: str = "2026-10-01T00:00:00"
    ) -> list[FetchedListing]:
        """Fetch all listings published after min_date_iso (Phase 7.5: strictly >= 2026-10-01)."""
        collected: dict[int, FetchedListing] = {}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # Query strictly by published date after min_date (matches 2026-2027 promotion)
            await self._fetch_query(client, {"after": min_date_iso}, collected, min_date_iso=min_date_iso)

        return list(collected.values())

    async def _fetch_query(
        self,
        client: httpx.AsyncClient,
        params: dict[str, str],
        collected: dict[int, FetchedListing],
        min_date_iso: str = "2026-10-01T00:00:00",
    ) -> None:
        """Fetch paginated posts from endpoint and merge into collected dict."""
        page = 1
        per_page = 50

        # Parse threshold datetime
        try:
            threshold_dt = datetime.fromisoformat(min_date_iso)
            if threshold_dt.tzinfo is None:
                threshold_dt = threshold_dt.replace(tzinfo=timezone.utc)
        except Exception:
            threshold_dt = None

        while True:
            query = dict(params)
            query["page"] = str(page)
            query["per_page"] = str(per_page)

            try:
                resp = await client.get(f"{self.base_url}/posts", params=query)
                if resp.status_code == 400:
                    # Page out of bounds in WP REST API
                    break
                resp.raise_for_status()
            except httpx.HTTPError:
                break

            items = resp.json()
            if not items or not isinstance(items, list):
                break

            for p in items:
                post_id = p.get("id")
                if not post_id or post_id in collected:
                    continue

                pub_at = None
                if p.get("date"):
                    try:
                        pub_at = datetime.fromisoformat(p["date"])
                        if pub_at.tzinfo is None:
                            pub_at = pub_at.replace(tzinfo=timezone.utc)
                    except Exception:
                        pass

                # Strict cutoff: discard any post older than threshold
                if threshold_dt and pub_at and pub_at < threshold_dt:
                    continue

                raw_title = p.get("title", {}).get("rendered", "")
                company_name = html.unescape(raw_title).strip()
                slug = p.get("slug", f"post-{post_id}")
                content_html = p.get("content", {}).get("rendered", "")
                
                # Strip bonus guides and clean text
                cleaned_html = strip_bonus_section(content_html)
                description_text = clean_html_text(cleaned_html)
                pdf_url = extract_pdf_url(content_html)

                # Parse class_list domain categories and tags
                class_list = p.get("class_list", [])
                cat_names, tag_names = parse_class_list_taxonomies(class_list)

                # Parse structured hints from HTML
                hints = parse_html_sections(content_html)

                mod_at = None
                if p.get("modified"):
                    try:
                        mod_at = datetime.fromisoformat(p["modified"])
                        if mod_at.tzinfo is None:
                            mod_at = mod_at.replace(tzinfo=timezone.utc)
                    except Exception:
                        pass

                listing = FetchedListing(
                    wp_post_id=post_id,
                    slug=slug,
                    company_name=company_name,
                    post_url=p.get("link", f"https://pfebooks.com/{slug}/"),
                    published_at=pub_at,
                    modified_at=mod_at,
                    catalogue_term="2026-2027",
                    categories=p.get("categories", []),
                    tags=p.get("tags", []),
                    category_names=cat_names,
                    tag_names=tag_names,
                    description_html=cleaned_html,
                    description_text=description_text,
                    pdf_url=pdf_url,
                    location=hints.get("location"),
                    deadline=hints.get("deadline"),
                    apply_method=hints.get("apply_method"),
                    email=hints.get("email"),
                    external_url=hints.get("external_url"),
                    subject_count=hints.get("subject_count", 0),
                    subjects_preview=hints.get("subjects_preview", []),
                )
                collected[post_id] = listing

            total_pages = int(resp.headers.get("x-wp-totalpages", "1"))
            if page >= total_pages:
                break
            page += 1
