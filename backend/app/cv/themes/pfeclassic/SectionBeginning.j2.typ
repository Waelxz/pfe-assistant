#v(0.16cm)
#text(
  font: "{{ design.typography.font_family.section_titles }}",
  size: {{ design.typography.font_size.section_titles }},
  weight: 700,
)[{{ section_title | upper }}]
#v(0.08cm)
#line(length: 100%, stroke: {{ design.section_titles.line_thickness }})
#v({{ design.section_titles.space_below }})
{% if entry_type == "OneLineEntry" %}
#v(0.20cm)
{% endif %}
