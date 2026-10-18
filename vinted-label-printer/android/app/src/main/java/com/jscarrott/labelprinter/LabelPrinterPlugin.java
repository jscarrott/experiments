package com.jscarrott.labelprinter;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The few things the web app cannot do from inside an Android WebView:
 *
 * - receive files shared to the app from the share sheet, or opened with it;
 * - print, which a WebView's window.print() silently does nothing for;
 * - save a file, which a WebView's download link also silently does nothing for;
 * - hand a file to another app.
 *
 * Files cross the bridge as base64. Labels are tens to hundreds of kilobytes, so
 * that is simpler than streaming and costs nothing noticeable.
 */
@CapacitorPlugin(name = "LabelPrinter")
public class LabelPrinterPlugin extends Plugin {

    /** A label PDF is well under a megabyte; anything this big is not a label. */
    private static final long MAX_SHARED_BYTES = 50L * 1024 * 1024;

    private final List<Uri> pending = new ArrayList<>();

    @Override
    public void load() {
        Activity activity = getActivity();
        collect(activity.getIntent());
        // Forget the share once collected, so a configuration change or the app being
        // brought back from the recents list does not add the same label again.
        activity.setIntent(new Intent(Intent.ACTION_MAIN));
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collect(intent)) notifyListeners("shared", new JSObject(), true);
    }

    /** Note the files an intent carries. True if it carried any. */
    private boolean collect(Intent intent) {
        if (intent == null || intent.getAction() == null) return false;
        List<Uri> uris = new ArrayList<>();
        switch (intent.getAction()) {
            case Intent.ACTION_SEND: {
                Uri uri = streamExtra(intent);
                if (uri != null) uris.add(uri);
                break;
            }
            case Intent.ACTION_SEND_MULTIPLE: {
                ArrayList<Uri> list = streamListExtra(intent);
                if (list != null) uris.addAll(list);
                break;
            }
            case Intent.ACTION_VIEW:
                if (intent.getData() != null) uris.add(intent.getData());
                break;
            default:
                return false;
        }
        synchronized (pending) {
            pending.addAll(uris);
        }
        return !uris.isEmpty();
    }

    @SuppressWarnings("deprecation")
    private static Uri streamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> streamListExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    /** Hand over, once, every file shared to the app since the last call. */
    @PluginMethod
    public void takeSharedFiles(PluginCall call) {
        List<Uri> uris;
        synchronized (pending) {
            uris = new ArrayList<>(pending);
            pending.clear();
        }
        ContentResolver resolver = getContext().getContentResolver();
        JSArray files = new JSArray();
        List<String> skipped = new ArrayList<>();
        for (Uri uri : uris) {
            String name = displayName(resolver, uri);
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) throw new IOException("No stream");
                JSObject file = new JSObject();
                file.put("name", name);
                String type = resolver.getType(uri);
                file.put("type", type != null ? type : "");
                file.put("data", Base64.encodeToString(readAll(in), Base64.NO_WRAP));
                files.put(file);
            } catch (IOException | SecurityException e) {
                skipped.add(name);
            }
        }
        JSObject result = new JSObject();
        result.put("files", files);
        result.put("skipped", new JSArray(skipped));
        call.resolve(result);
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (RuntimeException ignored) {
            // Some providers refuse queries but still serve the stream.
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "shared-label";
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        for (int n; (n = in.read(buffer)) != -1; ) {
            total += n;
            if (total > MAX_SHARED_BYTES) throw new IOException("Too large");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }

    /**
     * Print a PDF through Android's print service, with the paper size preset to the
     * size the labels were laid out for and no margins, so "actual size" is the
     * default rather than something to find in a menu.
     */
    @PluginMethod
    public void printPdf(PluginCall call) {
        byte[] pdf = pdfFrom(call);
        if (pdf == null) return;
        String name = call.getString("name", "Labels");
        double widthMm = call.getDouble("widthMm", 210.0);
        double heightMm = call.getDouble("heightMm", 297.0);

        PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(mediaSize(widthMm, heightMm))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                .build();

        getActivity().runOnUiThread(() -> {
            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            printManager.print(name, new PdfAdapter(name, pdf), attributes);
            call.resolve();
        });
    }

    private static PrintAttributes.MediaSize mediaSize(double widthMm, double heightMm) {
        if (near(widthMm, 210) && near(heightMm, 297)) return PrintAttributes.MediaSize.ISO_A4;
        if (near(widthMm, 105) && near(heightMm, 148)) return PrintAttributes.MediaSize.ISO_A6;
        if (near(widthMm, 101.6) && near(heightMm, 152.4)) return PrintAttributes.MediaSize.NA_INDEX_4X6;
        int widthMils = (int) Math.round(widthMm / 25.4 * 1000);
        int heightMils = (int) Math.round(heightMm / 25.4 * 1000);
        return new PrintAttributes.MediaSize("label_" + widthMils + "x" + heightMils, "Label", widthMils, heightMils);
    }

    private static boolean near(double a, double b) {
        return Math.abs(a - b) < 1;
    }

    /** Hands a finished PDF to the print framework as it is. */
    private static final class PdfAdapter extends PrintDocumentAdapter {
        private final String name;
        private final byte[] pdf;

        PdfAdapter(String name, byte[] pdf) {
            this.name = name;
            this.pdf = pdf;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                CancellationSignal cancellationSignal, LayoutResultCallback callback, Bundle extras) {
            if (cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name.endsWith(".pdf") ? name : name + ".pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .build();
            // The content never depends on the chosen paper: it was laid out already.
            callback.onLayoutFinished(info, oldAttributes == null);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                CancellationSignal cancellationSignal, WriteResultCallback callback) {
            try (OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                out.write(pdf);
                callback.onWriteFinished(new PageRange[] {PageRange.ALL_PAGES});
            } catch (IOException e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }

    /** Ask where to save the PDF (Downloads, Drive, …) and write it there. */
    @PluginMethod
    public void savePdf(PluginCall call) {
        if (pdfFrom(call) == null) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "labels.pdf"));
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject outcome = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            outcome.put("saved", false);
            call.resolve(outcome);
            return;
        }
        byte[] pdf = pdfFrom(call);
        if (pdf == null) return;
        try (OutputStream out = getContext().getContentResolver().openOutputStream(data.getData())) {
            if (out == null) throw new IOException("No stream");
            out.write(pdf);
            outcome.put("saved", true);
            call.resolve(outcome);
        } catch (IOException e) {
            call.reject("Could not save the PDF.", e);
        }
    }

    /** Offer the PDF to other apps: a printer maker's app, email, Drive. */
    @PluginMethod
    public void sharePdf(PluginCall call) {
        byte[] pdf = pdfFrom(call);
        if (pdf == null) return;
        String name = call.getString("name", "labels.pdf").replaceAll("[^A-Za-z0-9._-]", "_");
        File dir = new File(getContext().getCacheDir(), "outgoing");
        try {
            // Only ever the one most recent PDF in the cache.
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No cache directory");
            File file = new File(dir, name);
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(pdf);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("application/pdf")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, null));
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Could not share the PDF.", e);
        }
    }

    /** The PDF bytes from a call, or null after rejecting it. */
    private static byte[] pdfFrom(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("No PDF given.");
            return null;
        }
        try {
            return Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The PDF was not valid base64.");
            return null;
        }
    }
}
