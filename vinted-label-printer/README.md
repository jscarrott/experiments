# Label Printer

A self-hosted take on [Crop My Label](https://www.cropmylabel.co.uk/): drop in the A4
shipping-label PDF Vinted gives you and get just the label, cropped and scaled to fill.
Print it four or two to an A4 sheet on an ordinary printer, or one per page on a 4×6
thermal label printer, or save it as a PDF.

It is a static site. Everything happens in the browser — the PDF is read, cropped and
printed on your machine — so the server only ever hands out HTML and JavaScript, and
there is no monthly label allowance to run out of.

## What it does

- **Finds the label on the page.** Drop in the A4 sheet; the instructions, the
  "thank you for selling" text and the cut lines are left behind.
- **Knows the carrier.** Royal Mail, Evri, InPost, DPD and Yodel are recognised from
  the text in the PDF and shown on each label.
- **Remembers your fixes.** If an automatic crop is off, drag it right once and press
  *Use this crop for all Evri labels*. Every later Evri sheet uses that crop. This is
  the feature that makes the tool trustworthy: if Vinted changes a template, one
  correction fixes every label after it.
- **Batches.** Drop several PDFs at once; print them in one job or download one PDF
  with a page per label. Blank pages (Vinted's PDFs often have a blank second page)
  are skipped, and any label can be left out.
- **Packs labels onto A4.** The default puts four labels on each A4 sheet, one per
  quarter. Each quarter is A6, which is close to 4×6, and the quarters match the
  common 4-per-sheet A4 sticker sheets. Two per sheet (A5 halves) and one per sheet
  are also available. **Start at** lets you finish a part-used sticker sheet, e.g.
  start at the bottom left when the top two stickers are gone; the next sheet starts
  from the top again. On plain paper, cut guides mark where to cut.
- **Prints at the right size.** Print opens the browser's dialog with the page size
  already set (A4, or the label stock for a label printer) and no margins. Print at
  100% / actual size, not "fit to page", or labels will not line up with stickers.
- **QR labels.** Paste a code or a link and get a big, scannable QR code on a label,
  with an optional caption.
- **Images too.** A screenshot or a scan works as well as a PDF, and a screenshot can
  be pasted straight in with Ctrl+V.

Settings: what to print on (A4 at 4, 2 or 1 per sheet, or a label printer with 4×6 in,
100×150 mm, A6 or 4×4 in stock), margin, 203 or 300 DPI, turning landscape labels to
fit, cut guides, and pure black and white output.

The margin defaults to 4 mm because most home printers cannot print right up to the
paper edge; on a label printer it can go lower. Black and white is on by default
because barcodes scan best with hard edges, and thermal printers cannot print grey at
all: left to the printer driver, anti-aliased edges get dithered, and dithered barcode
edges are where scans fail.

## Android app (APK)

`android/` wraps the same site into a real Android app with
[Capacitor](https://capacitorjs.com/). The whole app is inside the APK, so it needs
no server, no hosting and no network. Install the APK, and that is everything.

- **Share from Vinted:** Label Printer appears in the share sheet for PDFs and images,
  and in "Open with" for downloaded PDFs. Share a label to it and it opens cropped.
- **Print** goes straight to Android's print service, with the paper size preset to
  A4 (or the label stock) and no margins.
- **Save PDF** asks where to save (Downloads, Drive, …). **Share** sends the finished
  PDF to another app, such as a thermal printer's own app.

A web page inside an Android WebView cannot print, download or receive shared files
by itself, so a small native plugin does those three things
(`android/app/src/main/java/com/jscarrott/labelprinter/LabelPrinterPlugin.java`, about
300 lines). Everything else is the same code as the website.

### Installing it

Copy the APK to the phone and open it. Android asks once to allow installs from
whichever app you opened it with (Files, Chrome, Drive). It is not on the Play Store.

### Building it

Needs JDK 21 and the Android SDK (platform 35).

```bash
npm run android:apk   # -> android/app/build/outputs/apk/release/app-release.apk
```

Signing reads `android/keystore.properties` (format in `android/app/build.gradle`).
Without it the APK is unsigned, and Android will not install an unsigned APK.
**Keep the keystore.** Android only installs an update over an app signed with the
same key; with a new key you have to uninstall first, which loses saved crops and
settings.

`.github/workflows/label-printer-apk.yml` builds the APK on GitHub: run it from the
Actions tab, or push a `label-printer-v*` tag. It signs with the keystore in the
repository secrets it lists.

## As an installable web app

Without the APK, it installs as an app from Chrome: open the site, then **⋮ → Add to Home screen →
Install**. You get an icon, it runs full-screen, and it works offline once it has
been opened once.

Installing also puts **Label Printer** in Android's share sheet for PDFs and images.
In Vinted, open the label, share it, and pick Label Printer. The label arrives
already cropped, with no downloading and finding the file. The shared file goes to
the app on the phone, not to the server.

From there, **Print** goes through Android's print service (Mopria, or your printer
maker's plugin). **Share** hands the finished PDF to another app, which is the route
for a thermal printer whose own app does the printing.

Two requirements:

- **HTTPS.** Android only installs web apps from secure origins. Put the container
  behind a reverse proxy with a certificate. For a phone on your own tailnet,
  `tailscale serve --bg 8080` gives you HTTPS without exposing anything publicly.
- **Chrome** (or another Chromium browser) to install it. The share-sheet entry
  appears only once it is installed.

## How it finds the label

`src/detect/crop.ts` works from the ink on the page, not from a stored template for
each carrier, so a layout change at Vinted's end makes it worse rather than broken:

1. Rub out fold lines and cut-here lines, solid or dashed, so they do not join every
   block on the page into one.
2. Spread the ink a few millimetres so each block runs together, and split the page
   into the blobs that come out.
3. Score each blob. A label is large, has a frame round it, and has barcodes or a QR
   code — dense patches of ink that body text never has. Instructions are large too,
   but sparse and unframed.
4. Pull in close neighbours, so an unframed label whose barcode stands a little apart
   from the address comes back whole.

A page already label-sized (a carrier's own 4×6 PDF) is printed whole.

**Tested only on synthetic labels.** The detector is tested against generated pages
(`test/page.ts`) and a generated Vinted-style A4 PDF (`e2e/fixtures.ts`), not against
real Vinted labels, which contain buyers' addresses. Expect the first label from each
carrier to need checking. If one comes out wrong, fix it in the editor and save the
crop for that carrier.

## Running it

### Docker

```bash
docker compose up -d --build     # http://localhost:8080
```

nginx serves the built files with a strict Content-Security-Policy. `connect-src 'self'`
means the page could not send a label anywhere even if it tried. Put it behind your
usual reverse proxy for HTTPS. Over plain HTTP everything still works, except pasting
from the clipboard on some browsers.

### Any static host

```bash
npm install
npm run build        # -> dist/
```

`dist/` is plain files with relative paths. Copy it to any web server, NAS share or
GitHub Pages site. It needs to be served over HTTP: opening `index.html` from disk does
not work, because browsers will not start the PDF worker from a `file://` URL.

### Development

```bash
npm run dev          # dev server
npm test             # unit tests: detector, carrier detection, layout
npm run test:e2e     # Playwright, against the built site
npm run check        # typecheck + unit + build + e2e
```

## Layout

```
src/
  detect/      pure functions: find the label, name the carrier — unit-tested in Node
  layout/      pure functions: fit a crop onto the label stock, lay labels out on A4
  output/      draw the finished label, print it, write the PDF
  ui/          the crop editor
  source.ts    PDFs and images in, renderable pages out (pdf.js)
  jobs.ts      a page plus its preview, carrier and crop
  store.ts     settings and saved crops, in this browser's storage
  pwa.ts       service worker registration, files shared from Android
  native.ts    the Android app's print, save, share and shared-file plugin
android/       the Capacitor Android project (LabelPrinterPlugin.java is the native code)
public/
  sw.js        offline cache, and receiving shared files
  manifest.webmanifest, icons/   (icons drawn by scripts/make-icons.mjs)
```

## What it doesn't do

- **No browser extension.** Crop My Label hooks Vinted's print button. Here you save
  the PDF from Vinted and drop it in. That is one more step, but nothing needs access
  to your Vinted session.
- **No direct printer driver.** Printing goes through the browser's print dialog. With
  a label printer, set its default paper to 4×6 once in the OS printer settings.
- **No sticker-sheet calibration.** Labels are placed on exact A4 quarters or halves.
  If your printer shifts the page by a millimetre or two, raise the margin rather than
  expect a perfect fit to the sticker edges.
- Saved crops and settings live in the browser you set them in, so a crop saved on a
  laptop does not follow you to a phone.
