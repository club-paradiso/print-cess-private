using System.Buffers.Binary;
using Paradiso.PrintCess.Core.Documents;
using Paradiso.PrintCess.Core.Protocol;

namespace Paradiso.PrintCess.Tests.Protocol;

public sealed class PrintBundleTests
{
    [Fact]
    public void ParseReadsMixedDocumentsInOrder()
    {
        var encoded = Encode(
            (DocumentKind.Jpeg, new byte[] { 0xff, 0xd8, 0xff, 1 }),
            (DocumentKind.Pdf, "%PDF-test"u8.ToArray()),
            (DocumentKind.Hwpx, new byte[] { 1, 2, 3, 4 }));

        using var bundle = PrintBundle.Parse(encoded);

        Assert.Equal(
            new[] { DocumentKind.Jpeg, DocumentKind.Pdf, DocumentKind.Hwpx },
            bundle.Entries.Select(entry => entry.Kind));
        Assert.Equal(new byte[] { 0xff, 0xd8, 0xff, 1 }, bundle.Entries[0].Bytes);
        Assert.Equal("%PDF-test"u8.ToArray(), bundle.Entries[1].Bytes);
    }

    [Fact]
    public void ParseRejectsNestedBundleAndTrailingBytes()
    {
        var nested = Encode((DocumentKind.Bundle, new byte[] { 1 }));
        Assert.Throws<EnvelopeFormatException>(() => PrintBundle.Parse(nested));

        var valid = Encode((DocumentKind.Png, new byte[] { 1, 2, 3 }));
        Array.Resize(ref valid, valid.Length + 1);
        Assert.Throws<EnvelopeFormatException>(() => PrintBundle.Parse(valid));
    }

    [Fact]
    public void ParseAcceptsThirtyPhotosInOrder()
    {
        var encoded = Encode(Enumerable.Range(0, 30)
            .Select(index => (DocumentKind.Jpeg, new byte[] { 0xff, 0xd8, checked((byte)index) }))
            .ToArray());
        using var bundle = PrintBundle.Parse(encoded);
        Assert.Equal(30, bundle.Entries.Count);
        Assert.Equal(29, bundle.Entries[29].Bytes[2]);
    }

    [Fact]
    public void ParseAcceptsThirtyMixedDocumentsInOrder()
    {
        var kinds = new[] { DocumentKind.Pdf, DocumentKind.Jpeg, DocumentKind.Png, DocumentKind.Hwpx, DocumentKind.Hwp };
        var originals = Enumerable.Range(0, 30)
            .Select(index => (kinds[index % kinds.Length], new byte[] { checked((byte)index), 1 }))
            .ToArray();

        using var bundle = PrintBundle.Parse(Encode(originals));

        Assert.Equal(30, bundle.Entries.Count);
        for (var index = 0; index < originals.Length; index++)
        {
            Assert.Equal(originals[index].Item1, bundle.Entries[index].Kind);
            Assert.Equal(originals[index].Item2, bundle.Entries[index].Bytes);
        }
    }

    [Fact]
    public void ParseRejectsThirtyOneDocumentsOrPhotos()
    {
        foreach (var kind in new[] { DocumentKind.Pdf, DocumentKind.Jpeg })
        {
            var encoded = Encode(Enumerable.Range(0, 31)
                .Select(_ => (kind, new byte[] { 1 }))
                .ToArray());
            Assert.Throws<EnvelopeFormatException>(() => PrintBundle.Parse(encoded));
        }
    }

    private static byte[] Encode(params (DocumentKind Kind, byte[] Bytes)[] items)
    {
        var length = 12 + items.Sum(item => 8 + item.Bytes.Length);
        var output = new byte[length];
        "PCBNDL01"u8.CopyTo(output);
        output[8] = 1;
        output[9] = checked((byte)items.Length);
        var offset = 12;
        foreach (var item in items)
        {
            output[offset] = (byte)item.Kind;
            BinaryPrimitives.WriteUInt32BigEndian(output.AsSpan(offset + 4, 4), checked((uint)item.Bytes.Length));
            offset += 8;
            item.Bytes.CopyTo(output, offset);
            offset += item.Bytes.Length;
        }
        return output;
    }
}
