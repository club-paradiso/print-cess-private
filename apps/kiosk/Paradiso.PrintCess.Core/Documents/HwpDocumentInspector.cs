using System.Buffers.Binary;

namespace Paradiso.PrintCess.Core.Documents;

internal static class HwpDocumentInspector
{
    private const uint RejectedPropertyMask =
        (1u << 1) | // password encryption
        (1u << 2) | // distribution document
        (1u << 3) | // script
        (1u << 4) | // DRM
        (1u << 8);  // certificate encryption

    private static ReadOnlySpan<byte> CompoundFileSignature =>
        [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

    private static ReadOnlySpan<byte> HwpFileHeaderSignature => "HWP Document File"u8;

    public static bool LooksLikeHwp(ReadOnlySpan<byte> content) =>
        content.Length >= 512 && content[..8].SequenceEqual(CompoundFileSignature);

    public static DocumentProperties Validate(ReadOnlySpan<byte> content)
    {
        if (!LooksLikeHwp(content) ||
            BinaryPrimitives.ReadUInt16LittleEndian(content[0x1c..0x1e]) != 0xfffe)
        {
            throw new DocumentValidationException(DocumentValidationError.CorruptHwp);
        }

        var sectorShift = BinaryPrimitives.ReadUInt16LittleEndian(content[0x1e..0x20]);
        if (sectorShift is not (9 or 12) ||
            BinaryPrimitives.ReadUInt16LittleEndian(content[0x20..0x22]) != 6 ||
            BinaryPrimitives.ReadUInt32LittleEndian(content[0x38..0x3c]) != 4096)
        {
            throw new DocumentValidationException(DocumentValidationError.CorruptHwp);
        }

        var headerOffset = content.IndexOf(HwpFileHeaderSignature);
        if (headerOffset < 0 ||
            headerOffset + 40 > content.Length ||
            !ContainsUtf16DirectoryName(content, "FileHeader") ||
            !ContainsUtf16DirectoryName(content, "DocInfo"))
        {
            throw new DocumentValidationException(DocumentValidationError.CorruptHwp);
        }

        var properties = BinaryPrimitives.ReadUInt32LittleEndian(
            content[(headerOffset + 36)..(headerOffset + 40)]);
        if ((properties & RejectedPropertyMask) != 0)
        {
            var protectedMask = (1u << 1) | (1u << 2) | (1u << 4) | (1u << 8);
            throw new DocumentValidationException(
                (properties & protectedMask) != 0
                    ? DocumentValidationError.EncryptedHwp
                    : DocumentValidationError.UnsafeHwpContent);
        }

        foreach (var streamName in new[]
                 {
                     "Scripts",
                     "DefaultJScript",
                     "JScriptVersion",
                     "_VBA_PROJECT",
                     "Macros",
                 })
        {
            if (ContainsUtf16DirectoryName(content, streamName))
            {
                throw new DocumentValidationException(DocumentValidationError.UnsafeHwpContent);
            }
        }

        return new DocumentProperties(null, null, null);
    }

    /// <summary>
    /// Compound-file directory names compare case-insensitively, so a storage
    /// named "SCRIPTS" is the same storage to Hancom as "Scripts".
    /// </summary>
    private static bool ContainsUtf16DirectoryName(ReadOnlySpan<byte> content, string value)
    {
        var length = value.Length * 2;
        for (var offset = 0; offset + length <= content.Length; offset++)
        {
            if (MatchesUtf16IgnoreCase(content.Slice(offset, length), value))
            {
                return true;
            }
        }

        return false;
    }

    private static bool MatchesUtf16IgnoreCase(ReadOnlySpan<byte> candidate, string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            if (candidate[(index * 2) + 1] != 0 ||
                char.ToUpperInvariant((char)candidate[index * 2]) != char.ToUpperInvariant(value[index]))
            {
                return false;
            }
        }

        return true;
    }
}
