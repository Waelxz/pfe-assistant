{% if cv.name %}
= {{ cv.name }}
{% endif %}
{% if cv.headline %}
#v(0.22cm)
#align(center)[
  #text(
    font: "{{ design.typography.font_family.headline }}",
    size: 11pt,
    weight: 700,
  )[{{ cv.headline }}]
]
{% endif %}
#v(0.32cm)
#connections(
{% for connection in cv._connections %}
  [{{ connection }}],
{% endfor %}
)
#v({{ design.section_titles.space_above }} + 0.14cm)
