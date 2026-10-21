#if WINDOWS
using System.IO;
using System.Printing;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Xps;
using Paradiso.PrintCess.Core.Documents;
using Paradiso.PrintCess.Core.Printing;
using Paradiso.PrintCess.Core.Protocol;
using Windows.Data.Pdf;
using Windows.Storage.Streams;

namespace Paradiso.PrintCess.Infrastructure.Printing;

public sealed class WindowsPrintEngine : IPrintEngine
{
    private const double A4Width = 793.7007874016;
    private const double A4Height = 1122.5196850394;
    private const double Margin = 24.0;
    private const uint PdfLongEdgePixels = 2_339;

    private sealed class PrintQuotaExceededException : Exception
    {
        public PrintQuotaExceededException(string message)
            : base(message)
        {
        }
    }

    public Task<PrintResult> PrintAsync(
        ValidatedDocument document,
        PrintSettings settings,
        CancellationToken cancellationToken,
        Func<CancellationToken, Task>? onReadyToSubmit = null,
        Func<int, CancellationToken, Task<bool>>? authorizeQuotaOverride = null)
    {
        ArgumentNullException.ThrowIfNull(document);
        settings.EnsureKioskPolicy();

        var completion = new TaskCompletionSource<PrintResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                completion.TrySetResult(PrintOnStaAsync(
                    document,
                    settings,
                    onReadyToSubmit,
                    authorizeQuotaOverride,
                    cancellationToken).GetAwaiter().GetResult());
            }
            catch (OperationCanceledException exception)
            {
                completion.TrySetCanceled(exception.CancellationToken);
            }
            catch
            {
                completion.TrySetResult(PrintResult.Uncertain());
            }
        })
        {
            IsBackground = true,
            Name = "Print-cess print worker",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }

    public static PrinterState GetPrinterState(string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName))
        {
            return PrinterState.Unknown;
        }

        try
        {
            using var server = new LocalPrintServer();
            using var queue = server.GetPrintQueue(printerName);
            queue.Refresh();
            return GetPrinterState(queue);
        }
        catch (PrintSystemException)
        {
            return PrinterState.Unknown;
        }
    }

    private static async Task<PrintResult> PrintOnStaAsync(
        ValidatedDocument document,
        PrintSettings settings,
        Func<CancellationToken, Task>? onReadyToSubmit,
        Func<int, CancellationToken, Task<bool>>? authorizeQuotaOverride,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var server = new LocalPrintServer();
        PrintQueue queue;
        try
        {
            queue = server.GetPrintQueue(settings.PrinterName);
            queue.Refresh();
        }
        catch (PrintSystemException)
        {
            return PrintResult.Rejected("P-02");
        }

        using (queue)
        {
            var state = GetPrinterState(queue);
            if (state != PrinterState.Ready)
            {
                return PrintResult.Rejected(CodeFor(state));
            }

            PrintTicket ticket;
            try
            {
                ticket = CreateAndValidateTicket(queue);
            }
            catch (PrintPolicyException)
            {
                return PrintResult.Rejected("P-05");
            }

            FixedDocument fixedDocument;
            try
            {
                fixedDocument = await RenderDocumentAsync(document, cancellationToken);
            }
            catch (PrintQuotaExceededException)
            {
                return PrintResult.Rejected("Q-02");
            }
            catch (Exception exception) when (exception is InvalidDataException or ArgumentException or COMException or ProtocolException)
            {
                return PrintResult.Rejected("F-01");
            }

            var renderedPageCount = fixedDocument.Pages.Count;
            var quotaDecision = PrintQuotaPolicy.Decide(renderedPageCount);
            if (quotaDecision == PrintQuotaDecision.HardLimitExceeded)
            {
                return PrintResult.Rejected("Q-02");
            }

            if (quotaDecision == PrintQuotaDecision.StaffOverrideRequired &&
                (authorizeQuotaOverride is null ||
                 !await authorizeQuotaOverride(renderedPageCount, cancellationToken)))
            {
                return PrintResult.Rejected("Q-01");
            }

            cancellationToken.ThrowIfCancellationRequested();
            if (onReadyToSubmit is not null)
            {
                await onReadyToSubmit(cancellationToken);
            }

            var submissionStarted = false;
            try
            {
                var writer = PrintQueue.CreateXpsDocumentWriter(queue);
                submissionStarted = true;
                // A multi-file selection is intentionally rendered into one
                // FixedDocument. The spooler therefore receives one guarded job
                // containing all pages, in the exact order selected on the phone.
                writer.Write(fixedDocument.DocumentPaginator, ticket);
                return PrintResult.Submitted();
            }
            catch (PrintSystemException)
            {
                return submissionStarted ? PrintResult.Uncertain() : PrintResult.Rejected("P-03");
            }
        }
    }

    private static PrintTicket CreateAndValidateTicket(PrintQueue queue)
    {
        var requested = new PrintTicket
        {
            PageMediaSize = new PageMediaSize(PageMediaSizeName.ISOA4),
            CopyCount = 1,
            Duplexing = System.Printing.Duplexing.OneSided,
            OutputColor = System.Printing.OutputColor.Grayscale,
        };
        var validation = queue.MergeAndValidatePrintTicket(queue.DefaultPrintTicket, requested);
        if (validation.ConflictStatus != ConflictStatus.NoConflict)
        {
            throw new PrintPolicyException("The printer rejected required ticket settings.");
        }

        var ticket = validation.ValidatedPrintTicket;
        if (ticket.PageMediaSize?.PageMediaSizeName != PageMediaSizeName.ISOA4 ||
            ticket.CopyCount != 1 ||
            ticket.Duplexing != System.Printing.Duplexing.OneSided ||
            ticket.OutputColor != System.Printing.OutputColor.Grayscale)
        {
            throw new PrintPolicyException("Validated printer ticket does not preserve the kiosk policy.");
        }

        return ticket;
    }

    private static async Task<FixedDocument> RenderDocumentAsync(
        ValidatedDocument document,
        CancellationToken cancellationToken)
    {
        var renderedPages = document.Kind == DocumentKind.Bundle
            ? await RenderBundleAsync(document.Content, cancellationToken)
            : await RenderPagesAsync(
                document.Content,
                document.Kind,
                PrintQuotaPolicy.SystemPageLimit,
                cancellationToken);

        if (renderedPages.Count == 0)
        {
            throw new InvalidDataException("The print job contains no rendered pages.");
        }

        var fixedDocument = new FixedDocument();
        fixedDocument.DocumentPaginator.PageSize = new Size(A4Width, A4Height);
        foreach (var bitmap in renderedPages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = new FixedPage
            {
                Width = A4Width,
                Height = A4Height,
                Background = Brushes.White,
            };
            var image = new Image
            {
                Source = bitmap,
                Stretch = Stretch.Uniform,
                Width = A4Width - (2 * Margin),
                Height = A4Height - (2 * Margin),
            };
            FixedPage.SetLeft(image, Margin);
            FixedPage.SetTop(image, Margin);
            page.Children.Add(image);
            var pageContent = new PageContent();
            ((IAddChild)pageContent).AddChild(page);
            fixedDocument.Pages.Add(pageContent);
        }

        return fixedDocument;
    }

    private static async Task<IReadOnlyList<BitmapSource>> RenderBundleAsync(
        byte[] content,
        CancellationToken cancellationToken)
    {
        using var bundle = PrintBundle.Parse(content);
        var pages = new List<BitmapSource>();
        foreach (var entry in bundle.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var remainingPageCapacity = PrintQuotaPolicy.SystemPageLimit - pages.Count;
            if (remainingPageCapacity <= 0)
            {
                throw new PrintQuotaExceededException("The print bundle exceeds the system page limit.");
            }

            var rendered = await RenderPagesAsync(
                entry.Bytes,
                entry.Kind,
                remainingPageCapacity,
                cancellationToken);
            pages.AddRange(rendered);
        }
        return pages;
    }

    private static async Task<IReadOnlyList<BitmapSource>> RenderPagesAsync(
        byte[] content,
        DocumentKind kind,
        int maximumPages,
        CancellationToken cancellationToken)
    {
        if (maximumPages < 1)
        {
            throw new PrintQuotaExceededException("The print job exceeds the system page limit.");
        }

        return kind switch
        {
            DocumentKind.Pdf => await RenderPdfAsync(content, maximumPages, cancellationToken),
            DocumentKind.Jpeg or DocumentKind.Png => [DecodeImage(content)],
            DocumentKind.Hwp or DocumentKind.Hwpx => await RenderHangulAsync(
                content,
                kind,
                maximumPages,
                cancellationToken),
            _ => throw new InvalidDataException("Unsupported document kind inside the print job."),
        };
    }

    private static BitmapFrame DecodeImage(byte[] content)
    {
        using var stream = new MemoryStream(content, writable: false);
        var decoder = BitmapDecoder.Create(
            stream,
            BitmapCreateOptions.PreservePixelFormat,
            BitmapCacheOption.OnLoad);
        if (decoder.Frames.Count != 1 || decoder.Frames[0].PixelWidth <= 0 || decoder.Frames[0].PixelHeight <= 0)
        {
            throw new InvalidDataException("Image decoder rejected the document.");
        }

        var frame = decoder.Frames[0];
        frame.Freeze();
        return frame;
    }

    private static async Task<IReadOnlyList<BitmapSource>> RenderHangulAsync(
        byte[] content,
        DocumentKind kind,
        int maximumPages,
        CancellationToken cancellationToken)
    {
        var pdf = await HancomHwpxRenderer.RenderToPdfAsync(content, kind, cancellationToken);
        try
        {
            return await RenderPdfAsync(pdf, maximumPages, cancellationToken);
        }
        finally
        {
            Array.Clear(pdf);
        }
    }

    private static async Task<IReadOnlyList<BitmapSource>> RenderPdfAsync(
        byte[] content,
        int maximumPages,
        CancellationToken cancellationToken)
    {
        using var input = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(input.GetOutputStreamAt(0)))
        {
            writer.WriteBytes(content);
            await writer.StoreAsync();
            await writer.FlushAsync();
            writer.DetachStream();
        }

        input.Seek(0);
        var pdf = await PdfDocument.LoadFromStreamAsync(input);
        if (pdf.PageCount < 1)
        {
            throw new InvalidDataException("PDF page count is outside the permitted range.");
        }

        if (pdf.PageCount > PortableDocumentValidator.MaximumPdfPages ||
            pdf.PageCount > checked((uint)maximumPages))
        {
            throw new PrintQuotaExceededException("The rendered document exceeds the system page limit.");
        }

        var bitmaps = new List<BitmapSource>(checked((int)pdf.PageCount));
        for (uint index = 0; index < pdf.PageCount; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var page = pdf.GetPage(index);
            var dimensions = page.Dimensions.MediaBox;
            if (dimensions.Width <= 0 || dimensions.Height <= 0)
            {
                throw new InvalidDataException("PDF page dimensions are invalid.");
            }

            var scale = PdfLongEdgePixels / Math.Max(dimensions.Width, dimensions.Height);
            var options = new PdfPageRenderOptions
            {
                DestinationWidth = checked((uint)Math.Max(1, Math.Round(dimensions.Width * scale))),
                DestinationHeight = checked((uint)Math.Max(1, Math.Round(dimensions.Height * scale))),
            };
            using var output = new InMemoryRandomAccessStream();
            await page.RenderToStreamAsync(output, options);
            if (output.Size is 0 or > 64 * 1024 * 1024)
            {
                throw new InvalidDataException("Rendered PDF page is outside the safe size limit.");
            }

            output.Seek(0);
            using var reader = new DataReader(output.GetInputStreamAt(0));
            await reader.LoadAsync(checked((uint)output.Size));
            var bytes = new byte[checked((int)output.Size)];
            reader.ReadBytes(bytes);
            bitmaps.Add(DecodeImage(bytes));
            Array.Clear(bytes);
        }

        return bitmaps;
    }

    private static PrinterState GetPrinterState(PrintQueue queue)
    {
        if (queue.IsOutOfPaper)
        {
            return PrinterState.OutOfPaper;
        }

        if (queue.IsOffline)
        {
            return PrinterState.Offline;
        }

        if (queue.IsPaused)
        {
            return PrinterState.Paused;
        }

        if (queue.IsInError || queue.NeedUserIntervention || queue.HasPaperProblem)
        {
            return PrinterState.Error;
        }

        return PrinterState.Ready;
    }

    private static string CodeFor(PrinterState state) => state switch
    {
        PrinterState.OutOfPaper => "P-01",
        PrinterState.Offline => "P-02",
        PrinterState.Paused => "P-03",
        PrinterState.Error => "P-03",
        _ => "P-00",
    };
}
#endif
