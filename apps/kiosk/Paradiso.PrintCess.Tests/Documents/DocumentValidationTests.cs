using Paradiso.PrintCess.Core.Documents;
using Paradiso.PrintCess.Tests.Fixtures;

namespace Paradiso.PrintCess.Tests.Documents;

public sealed class DocumentValidationTests
{
    private readonly PortableDocumentValidator _validator = new();

    [Fact]
    public void ValidatesPdfPngAndJpegByContent()
    {
        using var pdf = _validator.Validate(TestDocuments.OnePagePdf(), DocumentKind.Pdf, "application/pdf", TestDocuments.SessionId);
        using var png = _validator.Validate(TestDocuments.OnePixelPng(), DocumentKind.Png, "image/png", TestDocuments.SessionId);
        using var jpeg = _validator.Validate(TestDocuments.StructuralJpeg(), DocumentKind.Jpeg, "image/jpeg", TestDocuments.SessionId);

        Assert.Equal(1, pdf.Properties.PageCount);
        Assert.Equal((1, 1), (png.Properties.PixelWidth, png.Properties.PixelHeight));
        Assert.Equal((1, 1), (jpeg.Properties.PixelWidth, jpeg.Properties.PixelHeight));
    }

    [Fact]
    public void ValidatesCanonicalHwpxAndRejectsUnsafePackages()
    {
        using var hwpx = _validator.Validate(
            HwpxTestDocuments.Valid(),
            DocumentKind.Hwpx,
            "application/hwp+zip",
            TestDocuments.SessionId);
        Assert.Null(hwpx.Properties.PageCount);

        AssertError(DocumentValidationError.CorruptHwpx, () =>
            _validator.Validate(
                HwpxTestDocuments.Valid(mimeType: "application/zip"),
                DocumentKind.Hwpx,
                null,
                TestDocuments.SessionId));
        AssertError(DocumentValidationError.UnsafeHwpxContent, () =>
            _validator.Validate(
                HwpxTestDocuments.Valid(includeUnsafeScript: true),
                DocumentKind.Hwpx,
                null,
                TestDocuments.SessionId));
    }

    [Fact]
    public void ValidatesHwpAndRejectsProtectedOrScriptedDocuments()
    {
        using var hwp = _validator.Validate(
            HwpTestDocuments.Valid(),
            DocumentKind.Hwp,
            "application/x-hwp",
            TestDocuments.SessionId);
        Assert.Null(hwp.Properties.PageCount);

        AssertError(DocumentValidationError.EncryptedHwp, () =>
            _validator.Validate(
                HwpTestDocuments.Valid(properties: 1u << 1),
                DocumentKind.Hwp,
                null,
                TestDocuments.SessionId));
        AssertError(DocumentValidationError.EncryptedHwp, () =>
            _validator.Validate(
                HwpTestDocuments.Valid(properties: 1u << 2),
                DocumentKind.Hwp,
                null,
                TestDocuments.SessionId));
        AssertError(DocumentValidationError.UnsafeHwpContent, () =>
            _validator.Validate(
                HwpTestDocuments.Valid(includeScriptStream: true),
                DocumentKind.Hwp,
                null,
                TestDocuments.SessionId));
        AssertError(DocumentValidationError.UnsafeHwpContent, () =>
            _validator.Validate(
                HwpTestDocuments.Valid(includeScriptStream: true, scriptStreamName: "SCRIPTS"),
                DocumentKind.Hwp,
                null,
                TestDocuments.SessionId));
    }

    [Fact]
    public void RejectsMagicAndMimeMismatches()
    {
        AssertError(DocumentValidationError.TypeMismatch, () =>
            _validator.Validate(TestDocuments.OnePixelPng(), DocumentKind.Pdf, "application/pdf", TestDocuments.SessionId));
        AssertError(DocumentValidationError.MimeMismatch, () =>
            _validator.Validate(TestDocuments.OnePixelPng(), DocumentKind.Png, "image/jpeg", TestDocuments.SessionId));
        AssertError(DocumentValidationError.TypeMismatch, () =>
            _validator.Validate("%PDF-fake"u8, DocumentKind.Png, "image/png", TestDocuments.SessionId));
        AssertError(DocumentValidationError.TypeMismatch, () =>
            _validator.Validate(HwpTestDocuments.Valid(), DocumentKind.Hwpx, null, TestDocuments.SessionId));
    }

    [Fact]
    public void RejectsLockedActiveCorruptAndOversizedPdf()
    {
        AssertError(DocumentValidationError.LockedPdf, () =>
            _validator.Validate(TestDocuments.OnePagePdf("/Encrypt 9 0 R"), DocumentKind.Pdf, null, TestDocuments.SessionId));
        AssertError(DocumentValidationError.ActivePdfContent, () =>
            _validator.Validate(TestDocuments.OnePagePdf("/OpenAction 9 0 R"), DocumentKind.Pdf, null, TestDocuments.SessionId));
        AssertError(DocumentValidationError.TooManyPages, () =>
            _validator.Validate(TestDocuments.PdfWithPages(51), DocumentKind.Pdf, null, TestDocuments.SessionId));
        AssertError(DocumentValidationError.CorruptPdf, () =>
            _validator.Validate("%PDF-1.4 no trailer"u8, DocumentKind.Pdf, null, TestDocuments.SessionId));
    }

    [Fact]
    public void RejectsCorruptImageCrcAndTrailingData()
    {
        var changed = TestDocuments.OnePixelPng();
        changed[changed.Length - 5] ^= 1;
        AssertError(DocumentValidationError.CorruptImage, () =>
            _validator.Validate(changed, DocumentKind.Png, null, TestDocuments.SessionId));

        var trailing = TestDocuments.OnePixelPng().Concat(new byte[] { 0 }).ToArray();
        AssertError(DocumentValidationError.CorruptImage, () =>
            _validator.Validate(trailing, DocumentKind.Png, null, TestDocuments.SessionId));
    }

    [Fact]
    public void RejectsOversizedFilesAndImageDimensionsBeforeAllocationHeavyWork()
    {
        var oversized = new byte[(10 * 1024 * 1024) + 1];
        AssertError(DocumentValidationError.TooLarge, () =>
            _validator.Validate(oversized, DocumentKind.Pdf, null, TestDocuments.SessionId));

        var extremeJpeg = TestDocuments.StructuralJpeg();
        extremeJpeg[9] = 0x4e;
        extremeJpeg[10] = 0x21;
        AssertError(DocumentValidationError.ImageDimensionsTooLarge, () =>
            _validator.Validate(extremeJpeg, DocumentKind.Jpeg, null, TestDocuments.SessionId));
    }

    [Fact]
    public void DisposalClearsPlaintextAndDigest()
    {
        var validated = _validator.Validate(TestDocuments.OnePagePdf(), DocumentKind.Pdf, null, TestDocuments.SessionId);
        var contentReference = validated.Content;
        var digestReference = validated.ContentSha256;

        validated.Dispose();

        Assert.All(contentReference, static value => Assert.Equal(0, value));
        Assert.All(digestReference, static value => Assert.Equal(0, value));
    }

    private static void AssertError(DocumentValidationError expected, Action action)
    {
        var exception = Assert.Throws<DocumentValidationException>(action);
        Assert.Equal(expected, exception.Error);
    }
}
