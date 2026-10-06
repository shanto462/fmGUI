# Structured output (guided JSON)

The model can be forced to answer with JSON that matches a schema. This is called guided generation. It works in:

- `fm respond --schema <file or inline json>`
- `fm serve` with `response_format: {"type": "json_schema", ...}`

The easiest way to get a schema that always works is `fm schema object`.

## fm schema object

### Syntax

```sh
fm schema object --name <RootName> [property declarations...]
```

Each type flag starts a new property. Modifiers apply to the property just before them.

| Flag | Result |
|------|--------|
| `--string <name>` | `{"type": "string"}` |
| `--integer <name>` (alias `--int`) | `{"type": "integer"}` |
| `--double <name>` (alias `--float`) | `{"type": "number"}` |
| `--boolean <name>` (alias `--bool`) | `{"type": "boolean"}` |
| `--object <name> --schema '<json>'` | A nested object. The schema goes into `$defs` and the property becomes a `$ref`. |
| `--anyOf --schema '<json>' --schema '<json>'` | The root becomes a union (`anyOf`) of the given schemas. |
| `--array` | Wraps the previous property: `{"type": "array", "items": {...}}` |
| `--optional` | Removes the previous property from `required`. It stays in `x-order`. |
| `--description <text>` | Adds `description` to the previous property. |

Tested aliases: `--int`, `--bool`, `--float` work. `--number`, `--str` and `--nested` do **not** work.

The help text uses `--nested` in an example. That fails:

```text
Error: SchemaError(errorDescription: Optional("Unknown argument: --nested"))
```

Use `--object` instead.

### Dot notation

`address.street` creates a nested object named after the first part, with a capital letter (`address` → `Address`, `tags` → `Tags`):

```sh
fm schema object --name Restaurant \
  --string name --description 'Name of the restaurant' \
  --double average_rating --description 'Rating between 1 and 5' --optional \
  --string tags --array --description 'Tags for the restaurant' --optional \
  --string address.street --string address.zip
```

Real output (key order changes on every run):

```json
{
  "title" : "Restaurant",
  "$defs" : {
    "Address" : {
      "properties" : {
        "street" : { "type" : "string" },
        "zip" : { "type" : "string" }
      },
      "title" : "Address",
      "type" : "object",
      "x-order" : [ "street", "zip" ],
      "required" : [ "street", "zip" ],
      "additionalProperties" : false
    }
  },
  "required" : [ "name", "address" ],
  "x-order" : [ "name", "average_rating", "tags", "address" ],
  "additionalProperties" : false,
  "type" : "object",
  "properties" : {
    "address" : { "$ref" : "#\/$defs\/Address" },
    "name" : { "type" : "string", "description" : "Name of the restaurant" },
    "tags" : {
      "type" : "array",
      "items" : { "type" : "string" },
      "description" : "Tags for the restaurant"
    },
    "average_rating" : { "type" : "number", "description" : "Rating between 1 and 5" }
  }
}
```

### Nested objects and arrays of objects

```sh
fm schema object --name Order --string id \
  --object items --schema "$(fm schema object --name Item --string sku --integer qty)" \
  --array --optional --description 'Line items'
```

This gives `"items": {"type": "array", "items": {"$ref": "#/$defs/Item"}, "description": "Line items"}` and an `Item` entry in `$defs`. Note: `--array` must come **after** `--schema`. Before it you get `--object 'items' must be followed by --schema`.

### Unions

```sh
fm schema object --name SearchResult --anyOf \
  --schema "$(fm schema object --name Found --string name)" \
  --schema "$(fm schema object --name NotFound --string reason)"
```

Output: `{"title": "SearchResult", "anyOf": [{"$ref": "#/$defs/Found"}, {"$ref": "#/$defs/NotFound"}], "$defs": {...}}`.

If you mix normal properties with `--anyOf`, the normal properties are **silently dropped**.

### What the output looks like

Every object `fm schema object` makes has these keys:

| Key | Value |
|-----|-------|
| `type` | `"object"` |
| `title` | The `--name` |
| `properties` | The properties |
| `required` | All properties except `--optional` ones |
| `x-order` | All properties, in the order you declared them. The model generates fields in this order. |
| `additionalProperties` | `false` |

Other details:

- Nested schemas go to `$defs` and are linked with `$ref`.
- Slashes are escaped: `"#\/$defs\/Address"`. This is valid JSON and means `#/$defs/Address`.
- Key order is random between runs. Do not compare outputs as text.

### Errors

```text
Error: Missing expected argument '--name <name>'
Error: SchemaError(errorDescription: Optional("--optional must follow a property declaration"))
Error: SchemaError(errorDescription: Optional("--anyOf requires at least one --schema"))
Error: SchemaError(errorDescription: Optional("--object 'a' must be followed by --schema"))
Error: DecodingError.dataCorrupted: Data was corrupted. Debug description: The given data was not valid JSON. ...
```

`--schema` after a `--string` property gives `None of these keys were present: 'type', 'const', '$ref', 'anyOf'`.

## Using a schema with fm respond

```sh
# from a file
fm schema object --name Person --string name --integer age > person.schema.json
fm respond --schema person.schema.json 'Ada Lovelace is 36.'

# inline
fm respond --schema "$(fm schema object --name Person --string name --integer age)" 'Ada Lovelace is 36.'
```

```text
{"name": "Ada Lovelace", "age": 36}
```

The answer is one line of JSON on stdout.

### Gotcha: hand-written schemas fail in fm respond

A normal JSON Schema fails:

```sh
fm respond --schema '{"type":"object","properties":{"name":{"type":"string"},"age":{"type":"integer"}},"required":["name","age"]}' 'Ada Lovelace is 36 years old.'
```

```text
Error: Invalid schema at '<inline JSON>': The data couldn’t be read because it is missing.
```

Tested combinations for an object (with `type`, `properties` and, unless noted, `required`):

| Extra keys | Result |
|-----------|--------|
| none | missing |
| `additionalProperties` | missing |
| `x-order` | missing |
| `title` | missing |
| `additionalProperties` + `x-order` | `isn’t in the correct format` |
| `title` + `additionalProperties` | missing |
| `title` + `x-order` | missing |
| `title` + `additionalProperties` + `x-order` | **works** |
| all three, but no `required` | missing |
| all three, but no `type` | `isn’t in the correct format` |

So in `fm respond --schema`, **every object needs all six keys**: `type: "object"`, `title`, `properties`, `required`, `x-order`, `additionalProperties`.

More tested facts:

- `additionalProperties: true` is also accepted. The key must exist.
- `required: []` is how you make everything optional (the key must exist).
- **`x-order` decides which fields are generated.** With `"x-order": ["name"]` the answer was `{"name": "Ada Lovelace"}`, even though `age` was in `required`.
- Nested objects written inline (no `$defs`) work, if they also have the six keys.
- `enum` on a string works: `{"type": "string", "enum": ["happy", "sad"]}`.
- A top-level array works: `{"type": "array", "title": "L", "items": {"type": "string"}}` → `["Ada Lovelace"]`.
- A top-level string schema fails (`isn’t in the correct format`).

Minimal working hand-written schema:

```json
{
  "type": "object",
  "title": "Person",
  "properties": {
    "name": {"type": "string"},
    "age": {"type": "integer"}
  },
  "required": ["name", "age"],
  "x-order": ["name", "age"],
  "additionalProperties": false
}
```

## Using a schema with fm serve

`fm serve` fills in missing keys at the **top level** and in inline nested objects, so a normal schema works there:

| Schema (in `response_format.json_schema.schema`) | Result |
|---------------------------------|--------|
| `type`, `properties`, `required` only | Works |
| No `required` | Works, but optional fields may be skipped (`{"name": "Ada Lovelace"}`) |
| Inline nested object with only `type`, `properties`, `required` | Works |
| `"strict": true` next to `name` | Accepted |
| Top-level `{"type": "string"}` | Works, returns plain text |
| Top-level array | Works |
| `enum`, `const` | Work |
| `minimum`, `maximum`, `minItems`, `maxItems`, `minLength`, `maxLength`, `format` | Accepted, **not enforced** (`maxLength: 5` still gave a 12-letter name) |
| `pattern` | 500 `An unsupported generation guide was used.` |
| `"type": ["string", "null"]` | 400 `Expected to decode String but found an array instead.` |
| A string property with a `title` (Pydantic does this) | 400 `Named string types must have a non-empty enum field` |
| `$defs` entry without `title` | 400 `Object schemas require a 'title' key` |
| `$defs` entry without `required`, `x-order` or `additionalProperties` | 400 `Key '<name>' not found in keyed decoding container. Path: $defs.P` |
| Partial `x-order` at the top | Only the listed fields are generated |

So: **inside `$defs`, objects need all six keys**, like in `fm respond`. The full error text is long, for example:

```text
Invalid response_format schema: DecodingError.dataCorrupted: Data was corrupted. Path: properties.name.enum. Debug description: Named string types must have a non-empty enum field
```

## Pydantic and other generators

Schemas from Pydantic fail as they are, because Pydantic adds a `title` to every field and does not add `x-order` or `additionalProperties`. This helper fixed it in a test (Pydantic 2.11, `fm respond`):

```python
import json
import subprocess
from typing import List

from pydantic import BaseModel, Field


def fm_schema(node):
    """Make a JSON Schema (for example from Pydantic) acceptable to fm."""
    if isinstance(node, list):
        return [fm_schema(n) for n in node]
    if not isinstance(node, dict):
        return node
    out = {k: fm_schema(v) for k, v in node.items() if k != "default"}
    props = out.get("properties")
    if out.get("type") == "object" and props is not None:
        for p in props.values():
            if p.get("type") != "object" and "enum" not in p:
                p.pop("title", None)  # fm treats a titled string as an enum type
        out.setdefault("title", "Object")
        out.setdefault("required", list(props))
        out["x-order"] = list(props)
        out["additionalProperties"] = False
    return out


class Address(BaseModel):
    street: str
    city: str


class Person(BaseModel):
    name: str = Field(description="Full name")
    age: int
    tags: List[str]
    address: Address


schema = json.dumps(fm_schema(Person.model_json_schema()))
out = subprocess.run(
    ["fm", "respond", "--no-stream", "--schema", schema,
     "Ada Lovelace, 36, mathematician, lives at 1 Example Street, London."],
    capture_output=True, text=True, stdin=subprocess.DEVNULL, check=True,
).stdout
print(Person.model_validate_json(out))
```

Real output:

```text
name='Ada Lovelace' age=36 tags=['mathematician'] address=Address(street='1 Example Street', city='London')
```

Limits of this helper: it does not handle `Optional[...]` fields (Pydantic makes them `anyOf` with `null`, which `fm` rejects) or a property that is itself named `type`. Self-referencing models (a model that contains itself) were reported to hang (unverified).

## Tips

- Generate schemas with `fm schema object` or the helper above. Do not hand-write them without the six keys.
- Put fields in a useful order in `x-order`. The model writes them in that order, so put "reasoning" or "evidence" fields before "answer" fields if you want it to think first.
- Use `enum` for fixed choices. It is enforced.
- Do not trust `minimum`, `maxLength` and similar. Validate the result in your code.
- The answer is a JSON string. Always parse it and handle errors.
