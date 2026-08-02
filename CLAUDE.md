# Resume Engine — conventions

## Write endpoints

**Every partial update is a `PATCH` with merge semantics.** There are no `PUT`
handlers in this app, and new write endpoints should not add one.

For every `PATCH` endpoint:

- A field **absent** from the body means *leave this alone*.
- A field present as `null` or `""` means *clear it* — stored as `null`.
- An **array** present in the body replaces that array wholesale. Absent leaves
  it alone; `[]` clears it.

`POST` creates, `DELETE` removes, `GET` reads. Those are unaffected by this
rule.

### Why

Draft items and generated text are field-level edits on a nested structure.
Requiring a full resource on every inline edit would mean sending the whole
draft back on each keystroke-sized save, and a replace-shaped endpoint called
with a partial body silently wipes every field the caller did not mention. The
merge rule makes a partial body mean exactly what it looks like it means.

### Implementing it

Zod's `.optional()` and `.nullish()` both produce `undefined` for an absent
key, and `undefined` is the *only* value that means absent — `null` and `""`
arrive as themselves. So the test is always `!== undefined`:

```ts
const changes: { headline?: string | null } = {};
if (input.headline !== undefined) {
  changes.headline = normalizeText(input.headline); // "" and null → null
}
```

Build an object of just the requested changes and hand it to Prisma. Never
spread the parsed body straight into `data` — that writes `undefined` over
columns the caller never mentioned.

### A body that asks for nothing

An empty body is a valid no-op, not an error, and it must not have side
effects. `experiences/[id]` and `bullets/[id]` clear `needsReview` on save
because editing counts as reviewing — but only when the body actually asks for
a change, since a request that edits nothing has not reviewed anything.
