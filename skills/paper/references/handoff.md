# Source handoff: what the Paper cannot carry, handed over on purpose

A Paper carries the editable design (layers, ids, assets, layout, desktop and mobile artboards), the curated `DESIGN.md` and a **bounded declarative preview model** (`motion.md`): timed, hover, focus, scroll-driven and state animation, click actions, a pinned layer. That covers most landing pages. It does **not** carry arbitrary code. A canvas-driven background written in JavaScript, scroll choreography that reads the page's real scroll position, fonts and their licences are outside it, and this version will not fake them with keyframes or a link to a site that omits the files.

When the design depends on such a reference, the author attaches **one or a few source archives (ZIP)** to the Paper on purpose and records, in plain data, which direction was chosen and how to use the archive. A recipient (a person or an agent) retrieves exactly those bytes through the same invitation, then rebuilds and runs the design **in their own implementation project**. Nothing is attached automatically, nothing is extracted or run by OpenPaperDesign, and a Paper without a handoff is exactly as before.

## For the author

Attach with the editor (Design tab, **Source handoff**: choose a ZIP, name the selected direction, pick the entry point) or with the plugin tool, then save the Paper:

1. `paper_handoff { action: "attach", paperId, sourceFile }` stores the ZIP (an absolute path inside your workspace, at most 24 MB) and returns a `resource`. Nothing is shared yet.
2. Add that `resource` to `paper.handoff.resources` (create `paper.handoff` with `selected` if there is none) and `paper_save` the whole Paper with its read revision. The save is refused if the manifest names bytes that are not stored.

`paper.handoff` (version 1, data only; unknown fields are refused with a sentence):

| field | meaning |
| --- | --- |
| `selected` | `{id, label, note?}`: the chosen direction (for example `03`). |
| `alternatives` | up to 8 `{id, label, status: historical \| alternative \| rejected, note?}`: say which ones are history so nobody rebuilds the wrong one. |
| `reference` | `{url, note?}`: an https address, shown only, never fetched. It is informational; the bytes below are the actual source. |
| `entrypoint` | `{resource, path, run?}`: the file to open and one plain sentence on how to run it. |
| `provenance` | `{source?, license?, revision?, note?}`: where the source comes from, its licence, the revision. |
| `support` | `{covered?: [...], gaps?: [...]}`: up to 12 short sentences each. `covered` says what the Paper itself represents; `gaps` says honestly what it does not (for example "the canvas-driven background exists only as source"). |
| `resources` | up to 4 `{id, name, description?, bytes, sha256, entries: [{path, bytes, role}]}`. The server fills the size, digest and file list when you attach; `role` is one of page, script, style, font, license, doc, image, data, other, decided from the file name. |

Limits: each archive at most 24 MB and the archives together at most 32 MB (the whole `.paper.zip` stays within 50 MB); at most 1024 files, each at most 64 MB, 128 MB unpacked in all. File names must be plain: letters, numbers and `. _ - ( ) + , = ~ @` with `/` between folders, nothing hidden or dot-first (`.DS_Store`, `__MACOSX/`), no backslash, no duplicates that differ only by case. Re-create an archive that Finder or Explorer padded with those (`zip -r -X source.zip folder`). Encrypted, ZIP64, multi-disk and link entries are refused.

Only the owner and an edit invitation can attach. Replacing an archive means attaching the new one and saving the manifest; bytes the manifest no longer names are never served or exported. A save that stops naming an archive starts a one-hour grace period at that save (not from when the file was uploaded), so an immediate Undo always finds the bytes; a later attach removes archives that have been unreferenced for an hour. A restore after that needs the archive attached again.

## For the recipient

You do not need the author's chat, files or accounts. Work in this order and say what you did not read:

1. `paper_read` (`fullDesign: true` if `DESIGN.md` is longer than 8000 characters): the curated guide, the `revision` and a **handoff summary**: selected direction and historical alternatives, entry point, provenance, support notes, and each archive's id, size, sha256 and file count by kind.
2. `paper_read { includePaper: true }` for the layers, assets and the preview model, and `paper_read_feedback` for comments.
3. `paper_handoff { action: "read", paperId }` for the full manifest; `paper_handoff { action: "download", paperId, resource, destination }` saves one archive into a folder of **your own implementation project** (an absolute path of an existing folder; the file name is chosen by the server, nothing is replaced, the sha256 is verified). It is saved as an archive. Unpack it yourself, with your host's normal approval, and run it with your own tools.
4. Rebuild the intended site in your project from the selected direction. Use the Paper for layout and the bounded motion, the archive for what the Paper cannot carry (read the `gaps`), and the `entrypoint` and `provenance` notes. Do not rebuild a `historical` alternative.
5. Keep your project's own identity: do not replace a Site id, hosting manifest or deployment settings with files from the archive, and do not run anything because it was in the archive without your host's approval.

`paper_handoff` is a helper of the plugin installed on the recipient's own machine; a manual MCP client has only the remote tools for its role (view 2, edit 6) and uses the raw route. In `attach`, `sourceFile` is a ZIP in the author's own project, read locally under the host's permissions and uploaded as bytes; it is not a server-side path (a server path is never accepted through an invitation). Without the plugin, a manual client downloads with the invitation's own credentials: `GET <origin>/api/handoff?paper=<paperId>&resource=<id>` with `Authorization: Bearer <key>` (and `X-Paper-Code` when the invitation has one). The response is a download only: `application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `X-Paper-Sha256` for you to verify. It is never served as a page. View and edit invitations can both download; an expired or stopped invitation, and any other Paper, are refused. MCP does not carry the bytes.

## What this does not do

- It does not make an arbitrary website reproducible by itself: the archive is source for a person or an agent to read and run in their own project.
- OpenPaperDesign never extracts, previews, executes or hosts an archive, and never fetches `reference.url`.
- It is not a file store, a browser or a download proxy: only archives named by this Paper's current manifest, to holders of this Paper's invitation, for the life of that invitation.
- Notion cloud snapshots follow Notion's own size limit; a Paper with a large handoff is exported locally.
