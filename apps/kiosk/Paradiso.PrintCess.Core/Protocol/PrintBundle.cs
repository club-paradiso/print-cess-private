using System.Buffers.Binary;
using System.Security.Cryptography;
using Paradiso.PrintCess.Core.Documents;

namespace Paradiso.PrintCess.Core.Protocol;

public sealed class PrintBundle : IDisposable
{
    private const int BundleHeaderBytes = 12;
    private const int EntryHeaderBytes = 8;
    private static ReadOnlySpan<byte> Magic => [0x50, 0x43, 0x42, 0x4e, 0x44, 0x4c, 0x30, 0x31];
    private bool _disposed;

    private PrintBundle(IReadOnlyList<PrintBundleEntry> entries)
    {
        Entries = entries;
    }

    public IReadOnlyList<PrintBundleEntry> Entries { get; }

    public static bool LooksLike(ReadOnlySpan<byte> bytes) =>
        bytes.Length >= Magic.Length && bytes[..Magic.Length].SequenceEqual(Magic);

    public static PrintBundle Parse(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length is < BundleHeaderBytes or > BinaryEnvelope.MaxBundleBytes)
        {
            throw new EnvelopeFormatException("Print bundle size is invalid.");
        }
        if (!LooksLike(bytes))
        {
            throw new EnvelopeFormatException("Print bundle magic is invalid.");
        }
        if (bytes[8] != 1 || BinaryPrimitives.ReadUInt16BigEndian(bytes[10..12]) != 0)
        {
            throw new EnvelopeFormatException("Print bundle version or flags are invalid.");
        }

        var count = bytes[9];
        if (count is < 1 or > BinaryEnvelope.MaxBundleFiles)
        {
            throw new EnvelopeFormatException("Print bundle file count is invalid.");
        }

        var entries = new List<PrintBundleEntry>(count);
        var offset = BundleHeaderBytes;
        try
        {
            for (var index = 0; index < count; index++)
            {
                if (offset + EntryHeaderBytes > bytes.Length)
                {
                    throw new EnvelopeFormatException("Print bundle is truncated.");
                }

                var kind = bytes[offset] switch
                {
                    (byte)DocumentKind.Pdf => DocumentKind.Pdf,
                    (byte)DocumentKind.Jpeg => DocumentKind.Jpeg,
                    (byte)DocumentKind.Png => DocumentKind.Png,
                    (byte)DocumentKind.Hwpx => DocumentKind.Hwpx,
                    (byte)DocumentKind.Hwp => DocumentKind.Hwp,
                    (byte)DocumentKind.Bundle => throw new EnvelopeFormatException("Nested print bundles are not supported."),
                    _ => throw new EnvelopeFormatException("Print bundle file kind is unsupported."),
                };
                if (bytes[offset + 1] != 0 || BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 2, 2)) != 0)
                {
                    throw new EnvelopeFormatException("Print bundle entry flags are invalid.");
                }

                var length = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset + 4, 4));
                if (length is 0 or > BinaryEnvelope.MaxPlaintextBytes)
                {
                    throw new EnvelopeFormatException("Print bundle entry size is invalid.");
                }
                offset += EntryHeaderBytes;
                if ((ulong)offset + length > (ulong)bytes.Length)
                {
                    throw new EnvelopeFormatException("Print bundle is truncated.");
                }

                var content = bytes.Slice(offset, checked((int)length)).ToArray();
                entries.Add(new PrintBundleEntry(kind, content));
                offset = checked(offset + (int)length);
            }

            if (offset != bytes.Length)
            {
                throw new EnvelopeFormatException("Print bundle has trailing data.");
            }
            return new PrintBundle(entries);
        }
        catch
        {
            foreach (var entry in entries)
            {
                CryptographicOperations.ZeroMemory(entry.Bytes);
            }
            throw;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        foreach (var entry in Entries)
        {
            CryptographicOperations.ZeroMemory(entry.Bytes);
        }
    }
}

public sealed record PrintBundleEntry(DocumentKind Kind, byte[] Bytes);
