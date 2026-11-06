# Product page

Static HTML/CSS/modules with locally served Geist. No analytics, signup database or build step. OpenPaperDesign is Gustav Anderson’s personal open-source project.

Target domain: **https://openpaperdesign.gustavonline.com/**. Existing Cloudflare Pages project: `openpaperdesign`, account `gustavonline`. The owner approved publication and removal of the old `openpaperdesign.arcitai.com` address on 6 November 2026. Deployment and domain verification are recorded separately; source edits alone are not a deployment.

## Local review

```sh
python3 -m http.server 4389 --bind 127.0.0.1 --directory site
node --test tests/site.mjs
```

Check desktop/mobile, themes, navigation, gallery and Copy commands / Copy install prompt, including clipboard failure. The Online menu links to the owner’s existing menu for resources, one-on-one collaboration and custom projects. No new lead form is installed.

## Product claims

Installation uses the public Git marketplace for Codex and Claude Code, requiring Node.js 22+. Preview.17 is published with a SHA256 checksum. The site does not claim an official directory listing or preview.18 autosync availability. Notion snapshots, local files, optional sharing and supported exports match the released plugin. The three product screenshots are actual browser/plugin development previews, with provenance in `assets-sources.json`. Preserve upstream and asset licences.

## Deployment

Export only tracked `site/` files from the reviewed Git commit into a clean directory; never upload the repository root, owner Papers or configuration. Deploy that export to the existing Pages project, retain its previous production deployment for rollback, associate the new custom domain and verify HTTPS and file hashes. Remove the old custom-domain association and its exact DNS record after the new domain works. Do not remove other Arc’IT records or the Pages project itself.

The plugin ZIP excludes the website. Website publication and plugin release remain separate actions. The archived desktop repository and its issue transition are documented in `docs/legacy-transition.md`.
