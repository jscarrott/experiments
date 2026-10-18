/**
 * The Android app (see android/) runs this same site inside a WebView, where printing
 * and downloading silently do nothing. There, the plugin in LabelPrinterPlugin.java
 * does them instead, and also hands over files shared to the app.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface SharedFile {
  name: string;
  type: string;
  /** Base64. */
  data: string;
}

interface PdfOptions {
  /** Base64. */
  data: string;
  name: string;
}

interface LabelPrinterPlugin {
  takeSharedFiles(): Promise<{ files: SharedFile[]; skipped: string[] }>;
  printPdf(options: PdfOptions & { widthMm: number; heightMm: number }): Promise<void>;
  savePdf(options: PdfOptions): Promise<{ saved: boolean }>;
  sharePdf(options: PdfOptions): Promise<void>;
  addListener(event: 'shared', listener: () => void): Promise<PluginListenerHandle>;
}

const LabelPrinter = registerPlugin<LabelPrinterPlugin>('LabelPrinter');

export const isApp = () => Capacitor.isNativePlatform();

/** Files shared to the app, now and whenever more arrive while it is open. */
export function onSharedFiles(receive: (files: File[], skipped: string[]) => void): void {
  const take = async () => {
    const { files, skipped } = await LabelPrinter.takeSharedFiles();
    const converted = files.map((f) => new File([fromBase64(f.data)], f.name, { type: f.type }));
    if (converted.length || skipped.length) receive(converted, skipped);
  };
  void LabelPrinter.addListener('shared', () => void take());
  void take();
}

export async function printPdf(file: File, paper: { widthMm: number; heightMm: number }): Promise<void> {
  await LabelPrinter.printPdf({ data: await toBase64(file), name: file.name, ...paper });
}

export async function savePdf(file: File): Promise<boolean> {
  return (await LabelPrinter.savePdf({ data: await toBase64(file), name: file.name })).saved;
}

export async function sharePdf(file: File): Promise<void> {
  await LabelPrinter.sharePdf({ data: await toBase64(file), name: file.name });
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // In chunks: spreading a whole PDF into one call overflows the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
