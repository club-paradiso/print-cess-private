"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Crop,
  FileSearch,
  Images,
  Plus,
  RotateCw,
  ScanLine,
  Trash2,
} from "lucide-react";

import type { SupportedLocale } from "@print-cess/i18n";
import { PrimaryButton, SecondaryButton } from "@print-cess/ui";

import {
  detectDocument,
  processDocument,
  type DocumentQuad,
  type ScanFilter,
} from "@/lib/document-scan-engine";
import { recognizeDocument, terminateOcrWorker } from "@/lib/scan-ocr";
import { buildScannedPdf, type PdfImagePage } from "@/lib/scan-pdf";
import { advancedScanCopy } from "./scan-advanced-copy";
import { DocumentCropEditor } from "./document-crop-editor";
import { LiveDocumentCamera } from "./live-document-camera";
import { proScanCopy } from "./scan-pro-copy";
import { formatScanCopy, scanCopy } from "./scan-copy";

const MAX_PAGES = 10;

type ScanPage = {
  id: string;
  file: File;
  sourcePreviewUrl: string;
  previewUrl: string;
  rotation: number;
  quad: DocumentQuad;
  filter: ScanFilter;
  detected: boolean;
  confidence: number;
};

export function ScanComposer({
  locale,
  onComplete,
  onCancel,
}: {
  locale: SupportedLocale;
  onComplete: (file: File) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const copy = scanCopy(locale);
  const advanced = advancedScanCopy(locale);
  const pro = proScanCopy(locale);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [searchablePdf, setSearchablePdf] = useState(false);
  const [ocrFallbackPages, setOcrFallbackPages] = useState<PdfImagePage[] | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());

  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
      void terminateOcrWorker();
    },
    [],
  );

  const editingPage = useMemo(
    () => pages.find((page) => page.id === editingId),
    [editingId, pages],
  );

  const addSelectedFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0 || busy) return;
      setError("");
      setOcrFallbackPages(null);
      const remaining = MAX_PAGES - pages.length;
      if (files.length > remaining) setError(copy.tooMany);
      const selected = Array.from(files).slice(0, remaining);
      if (selected.length === 0) return;

      setBusy(true);
      setStatus(advanced.detecting);
      const added: ScanPage[] = [];
      try {
        for (const file of selected) {
          const sourcePreviewUrl = URL.createObjectURL(file);
          previewUrls.current.add(sourcePreviewUrl);
          const detection = await detectDocument(file);
          setStatus(advanced.processing);
          const processed = await processDocument(file, {
            quad: detection.quad,
            filter: "auto",
            preview: true,
          });
          const previewUrl = URL.createObjectURL(processed.blob);
          previewUrls.current.add(previewUrl);
          added.push({
            id: crypto.randomUUID(),
            file,
            sourcePreviewUrl,
            previewUrl,
            rotation: 0,
            quad: detection.quad,
            filter: "auto",
            detected: detection.detected,
            confidence: detection.confidence,
          });
          setStatus(advanced.detecting);
        }
        setPages((current) => [...current, ...added]);
        if (pages.length + added.length >= MAX_PAGES) setCameraOpen(false);
      } catch {
        for (const page of added) {
          URL.revokeObjectURL(page.sourcePreviewUrl);
          URL.revokeObjectURL(page.previewUrl);
          previewUrls.current.delete(page.sourcePreviewUrl);
          previewUrls.current.delete(page.previewUrl);
        }
        setError(copy.imageError);
      } finally {
        setBusy(false);
        setStatus("");
        if (cameraInput.current) cameraInput.current.value = "";
        if (galleryInput.current) galleryInput.current.value = "";
      }
    },
    [advanced.detecting, advanced.processing, busy, copy.imageError, copy.tooMany, pages.length],
  );

  const addFiles = useCallback(
    (selection: FileList | null) => addSelectedFiles(selection ? Array.from(selection) : []),
    [addSelectedFiles],
  );

  const updatePage = useCallback((id: string, update: (page: ScanPage) => ScanPage) => {
    setOcrFallbackPages(null);
    setPages((current) => current.map((page) => (page.id === id ? update(page) : page)));
  }, []);

  const movePage = useCallback((index: number, direction: -1 | 1) => {
    setOcrFallbackPages(null);
    setPages((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  }, []);

  const removePage = useCallback((id: string) => {
    setOcrFallbackPages(null);
    setPages((current) => {
      const removed = current.find((page) => page.id === id);
      if (removed) {
        for (const url of [removed.sourcePreviewUrl, removed.previewUrl]) {
          URL.revokeObjectURL(url);
          previewUrls.current.delete(url);
        }
      }
      return current.filter((page) => page.id !== id);
    });
    setEditingId((current) => (current === id ? null : current));
  }, []);

  const applyCrop = useCallback(
    async (id: string, value: { quad: DocumentQuad; filter: ScanFilter }) => {
      const page = pages.find((entry) => entry.id === id);
      if (!page || busy) return;
      setBusy(true);
      setStatus(advanced.processing);
      setError("");
      setOcrFallbackPages(null);
      try {
        const processed = await processDocument(page.file, {
          quad: value.quad,
          filter: value.filter,
          preview: true,
        });
        const nextPreviewUrl = URL.createObjectURL(processed.blob);
        previewUrls.current.add(nextPreviewUrl);
        const previousPreviewUrl = page.previewUrl;
        updatePage(id, (current) => ({
          ...current,
          quad: value.quad,
          filter: value.filter,
          previewUrl: nextPreviewUrl,
          detected: true,
        }));
        URL.revokeObjectURL(previousPreviewUrl);
        previewUrls.current.delete(previousPreviewUrl);
        setEditingId(null);
      } catch {
        setError(copy.imageError);
      } finally {
        setBusy(false);
        setStatus("");
      }
    },
    [advanced.processing, busy, copy.imageError, pages, updatePage],
  );

  const completePdf = useCallback(
    async (normalized: readonly PdfImagePage[]) => {
      const bytes = buildScannedPdf(normalized);
      const file = new File([bytes.buffer as ArrayBuffer], copy.scannedFile, {
        type: "application/pdf",
        lastModified: Date.now(),
      });
      await onComplete(file);
    },
    [copy.scannedFile, onComplete],
  );

  const makePdf = useCallback(async () => {
    if (pages.length === 0 || busy) return;
    setBusy(true);
    setStatus(advanced.processing);
    setError("");
    setOcrFallbackPages(null);
    try {
      const normalized: PdfImagePage[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]!;
        const processed = await processDocument(page.file, {
          quad: page.quad,
          filter: page.filter,
          rotation: page.rotation,
        });
        const pdfPage: PdfImagePage = {
          bytes: new Uint8Array(await processed.blob.arrayBuffer()),
          width: processed.width,
          height: processed.height,
        };

        if (searchablePdf) {
          setStatus(`${pro.ocrPreparing} ${index + 1}/${pages.length}`);
          try {
            const ocr = await recognizeDocument(
              processed.blob,
              locale,
              { width: processed.width, height: processed.height },
              ({ progress }) => {
                setStatus(
                  `${pro.ocrRecognizing} ${index + 1}/${pages.length} · ${Math.round(progress * 100)}%`,
                );
              },
            );
            pdfPage.ocrWords = ocr.words;
          } catch {
            const fallback = [
              ...normalized.map((entry) => ({
                bytes: entry.bytes,
                width: entry.width,
                height: entry.height,
              })),
              { bytes: pdfPage.bytes, width: pdfPage.width, height: pdfPage.height },
            ];
            for (let remaining = index + 1; remaining < pages.length; remaining += 1) {
              const source = pages[remaining]!;
              setStatus(advanced.processing);
              const rendered = await processDocument(source.file, {
                quad: source.quad,
                filter: source.filter,
                rotation: source.rotation,
              });
              fallback.push({
                bytes: new Uint8Array(await rendered.blob.arrayBuffer()),
                width: rendered.width,
                height: rendered.height,
              });
            }
            setOcrFallbackPages(fallback);
            setError(pro.ocrFailed);
            return;
          }
        }
        normalized.push(pdfPage);
      }
      await completePdf(normalized);
    } catch {
      setError(copy.genericError);
    } finally {
      await terminateOcrWorker();
      setBusy(false);
      setStatus("");
    }
  }, [
    advanced.processing,
    busy,
    completePdf,
    copy.genericError,
    locale,
    pages,
    pro,
    searchablePdf,
  ]);

  const makeImageOnlyFallback = useCallback(async () => {
    if (!ocrFallbackPages || busy) return;
    setBusy(true);
    setError("");
    try {
      await completePdf(ocrFallbackPages);
    } catch {
      setError(copy.genericError);
    } finally {
      setBusy(false);
    }
  }, [busy, completePdf, copy.genericError, ocrFallbackPages]);

  return (
    <section className="scan-composer" aria-busy={busy}>
      {onCancel ? (
        <button type="button" className="scan-back" onClick={onCancel} disabled={busy}>
          <ArrowLeft aria-hidden="true" /> {copy.closeScanner}
        </button>
      ) : null}
      <div className="scan-heading">
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </div>
      <input
        ref={cameraInput}
        data-testid="scan-camera-input"
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void addFiles(event.target.files)}
      />
      <input
        ref={galleryInput}
        data-testid="scan-gallery-input"
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => void addFiles(event.target.files)}
      />

      {pages.length === 0 ? (
        <div className="scan-empty">
          <Camera aria-hidden="true" />
          <p>{copy.empty}</p>
        </div>
      ) : (
        <>
          <div className="scan-page-count" aria-live="polite">
            {formatScanCopy(copy.pages, { count: pages.length })}
          </div>
          <ol className="scan-pages">
            {pages.map((page, index) => (
              <li key={page.id}>
                <div className="scan-page-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={`${index + 1}`}
                    style={{ transform: `rotate(${page.rotation}deg)` }}
                  />
                  <span className="scan-page-number">{index + 1}</span>
                  <span
                    className={`scan-detection-badge ${page.detected ? "is-detected" : "is-review"}`}
                    title={`${Math.round(page.confidence * 100)}%`}
                  >
                    {page.detected ? advanced.edgeFound : advanced.edgeNotFound}
                  </span>
                </div>
                <div className="scan-page-actions">
                  <button
                    type="button"
                    onClick={() => movePage(index, -1)}
                    disabled={index === 0 || busy}
                    aria-label={copy.moveEarlier}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => movePage(index, 1)}
                    disabled={index === pages.length - 1 || busy}
                    aria-label={copy.moveLater}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(page.id)}
                    disabled={busy}
                    aria-label={advanced.adjustCrop}
                  >
                    <Crop aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updatePage(page.id, (current) => ({
                        ...current,
                        rotation: (current.rotation + 90) % 360,
                      }))
                    }
                    disabled={busy}
                    aria-label={copy.rotate}
                  >
                    <RotateCw aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removePage(page.id)}
                    disabled={busy}
                    aria-label={copy.remove}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {pages.length > 0 ? (
        <label className="scan-ocr-option">
          <input
            type="checkbox"
            checked={searchablePdf}
            disabled={busy}
            onChange={(event) => {
              setSearchablePdf(event.target.checked);
              setOcrFallbackPages(null);
              setError("");
            }}
          />
          <span>
            <strong>
              <FileSearch aria-hidden="true" /> {pro.searchablePdf}
            </strong>
            <small>{pro.searchableHelp}</small>
            <small>{pro.privacyOcr}</small>
            <small>{pro.ocrNetwork}</small>
          </span>
        </label>
      ) : null}

      {status ? (
        <p className="scan-notice" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="scan-error" role="alert">
          {error}
        </p>
      ) : null}
      {ocrFallbackPages ? (
        <SecondaryButton onClick={() => void makeImageOnlyFallback()} disabled={busy}>
          {pro.imageOnlyPdf}
        </SecondaryButton>
      ) : null}

      {/* Once there is a page, making the PDF is the step forward and adding
          another page is the quieter alternative; before that, the camera is
          the only way in. One primary action at a time. Adding comes first
          because it happens first; making the PDF is pinned to the bottom of
          the screen so a long run of pages never pushes it out of reach. */}
      <div
        className={
          pages.length > 0
            ? "scan-primary-actions scan-primary-actions--more"
            : "scan-primary-actions"
        }
      >
        {pages.length === 0 ? (
          <PrimaryButton
            data-testid="scan-smart-camera"
            onClick={() => setCameraOpen(true)}
            disabled={busy}
          >
            <Camera aria-hidden="true" />
            {pro.liveCamera}
          </PrimaryButton>
        ) : (
          <SecondaryButton
            data-testid="scan-smart-camera"
            onClick={() => setCameraOpen(true)}
            disabled={busy || pages.length >= MAX_PAGES}
          >
            <Plus aria-hidden="true" />
            {pro.liveCamera}
          </SecondaryButton>
        )}
        <SecondaryButton
          onClick={() => cameraInput.current?.click()}
          disabled={busy || pages.length >= MAX_PAGES}
        >
          <Camera aria-hidden="true" /> {pro.cameraFallback}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => galleryInput.current?.click()}
          disabled={busy || pages.length >= MAX_PAGES}
        >
          <Images aria-hidden="true" /> {copy.gallery}
        </SecondaryButton>
      </div>
      {pages.length > 0 ? (
        <div className="mobile-actions">
          <PrimaryButton className="scan-make-pdf" onClick={() => void makePdf()} disabled={busy}>
            <ScanLine aria-hidden="true" /> {busy ? copy.making : copy.makePdf}
          </PrimaryButton>
        </div>
      ) : null}
      {editingPage ? (
        <DocumentCropEditor
          locale={locale}
          file={editingPage.file}
          previewUrl={editingPage.sourcePreviewUrl}
          initialQuad={editingPage.quad}
          initialFilter={editingPage.filter}
          onApply={(value) => void applyCrop(editingPage.id, value)}
          onCancel={() => setEditingId(null)}
        />
      ) : null}

      {cameraOpen ? (
        <LiveDocumentCamera
          locale={locale}
          disabled={busy}
          onCapture={(file) => addSelectedFiles([file])}
          onFallback={() => cameraInput.current?.click()}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </section>
  );
}
