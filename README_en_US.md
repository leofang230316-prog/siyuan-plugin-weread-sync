# WeRead Sync

Sync your WeRead books, highlights and notes into SiYuan, then search, browse and cite them inside SiYuan.

## Core Features

- **QR login + Cookie fallback**: Scan the WeChat QR code to sign in; if the environment blocks it, paste the browser Cookie manually.
- **Full / quick sync**: Sync all books, or only books that have notes. Supports resumption after interruption even for large shelves.
- **Incremental append, never overwrite local edits**: After the first sync, your annotations, rewrites and reorganisations in SiYuan remain intact across future syncs.
- **Conflict dual-version keep**: If a note is edited in both SiYuan and WeRead, the SiYuan version is kept and a separate "WeRead updated version" with a timestamp is appended.
- **Remote-deleted notes remain local**: Notes deleted in WeRead are kept in SiYuan with a "deleted in WeRead" marker. Nothing is silently removed.
- **Cite inside SiYuan**: Type `/weread` or `/读书` in the editor, or use the Dock panel "Insert" button, to insert a block reference to any synced note.
- **Mobile read-only**: Syncing and insertion happen on desktop; mobile can browse the shelf and note contents.

## Install

1. In SiYuan, open "Settings - Bazaar", click "Download - Local install" and select the generated `package.zip` from this repo.
2. Enable the plugin, then click the "WeRead" icon in the top bar to open the Dock panel.

## Usage

1. **Sign in**
   - Open the Dock panel and scan the QR code with WeChat.
   - If QR code fails, click "Paste Cookie manually", sign in at `weread.qq.com` in your browser, and paste the Cookie value.

2. **Sync**
   - "Sync all": walks through the shelf and creates/updates a SiYuan document for each book that has notes.
   - "Quick sync": only processes books with notes, which is faster.
   - You can cancel during sync; completed progress is preserved and can resume next time.

3. **Browse & cite**
   - Browse the shelf in the Dock panel. Click a book title to open its note document.
   - Click "Insert" on any note to insert a block reference at the current cursor.
   - Type `/weread` or `/读书` in the editor to search and insert any synced note.

4. **Settings**
   - Right-click the top bar icon and choose "Settings" to configure: target notebook, sync scope, concurrency, request interval, slash command triggers, scheduled sync, etc.

## Data Notes

- Login credentials (Cookies) are stored only in the plugin storage area of your SiYuan data directory. They are **never uploaded to any third-party server**.
- Book covers are cached in plugin memory by default and are not written into note documents or into SiYuan sync data.
- Documents are created only for books that have notes. Books without notes still appear in the shelf list but do not generate empty documents.

## Known Limitations

- SiYuan's `POST /api/network/forwardProxy` endpoint requires admin privileges, so the plugin cannot run under a non-admin account in Docker multi-user deployments.
- WeRead endpoints are reverse-engineered and may change when WeChat updates its services. The plugin shows explicit error messages when this happens.
- Version 1.0.0 does not sync edits from SiYuan back to WeRead.

## Difference from Similar Plugins

The existing `siyuan-plugin-weread` has not been updated for about two and a half years and uses an **overwrite strategy**, explicitly warning users "please do not edit the synced files". This plugin is designed from the ground up to protect local edits, using an incremental append + three-way merge strategy so your work in SiYuan is never overwritten.
