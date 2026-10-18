# Publishing the controller guide

The destination is the existing [AMAN (MAESTRO) page](https://wiki.vatsim-scandinavia.org/books/general/page/aman-maestro).
The current page documents the earlier plugin. Replace its content when the
SAAMAN rollout is approved, using an account with permission to edit that page.
The prepared files do not publish or alter the live wiki.

- `user-guide.html`: a complete, readable offline preview, with print styling.
- `user-guide-wiki.html`: the page body for the wiki's HTML/source editor.
- `user-guide.md`: the same text for a Markdown editor or future maintenance.

For the WYSIWYG editor, open the page's HTML/source view and paste the contents of
`user-guide-wiki.html`. Check the preview and save the page after reviewing it.
If source view is unavailable, open `user-guide.html`, select the contents inside
the main article and copy/paste the rendered text into the editor, then check
the headings, tables and lists. If using the Markdown editor, paste `user-guide.md`
and omit its first title line when the existing page title already supplies it.

The wiki fragment has no scripts, stylesheets, external fonts, images or private
GitHub links. It uses standard headings, paragraphs, lists, tables and inline code.
The wiki supplies its own appearance. No separate media uploads are needed.
BookStack editor reference: https://www.bookstackapp.com/docs/user/wysiwyg-editor/

Edit the Markdown source, then regenerate both HTML versions from the repository root:

```powershell
python ./source/scripts/build-user-guide.py
```

Use `--check` to verify that the generated versions are current. The guide covers
operation only; calculation details remain in the development documentation.

## Illustrated controller guide

The new practical guide is `controller-guide.md`. Open `controller-guide.html` for a standalone preview with its two pictures embedded. `controller-guide-wiki.html` is the HTML body for BookStack. Upload `docs/images/acc-l03-example.png` and `docs/images/acc-holding-example.png` with the wiki image picker, then replace the two relative image paths in the pasted fragment with the resulting wiki image URLs. Review the ACC, L03, holding and APP sections before publishing. These files do not alter the live wiki.

Regenerate with `python ./source/scripts/build-controller-illustrations.py` and `python ./source/scripts/build-user-guide.py --controller`; use `--controller --check` to verify the generated guide.
