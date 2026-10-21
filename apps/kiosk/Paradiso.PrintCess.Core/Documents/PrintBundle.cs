using Paradiso.PrintCess.Core.Protocol;

namespace Paradiso.PrintCess.Core.Documents;

internal static class PrintBundle
{
    private static ReadOnlySpan<byte> Magic => [0x50, 0x43, 0x42, 0x4e, 0x44, 0x4c, 0x30, 0x31];

    public static bool LooksLike(ReadOnlySpan<byte> bytes) =>
        bytes.Length >= Magic.Length && bytes[..Magic.Length].SequenceEqual(Magic);

    public static Paradiso.PrintCess.Core.Protocol.PrintBundle Parse(ReadOnlySpan<byte> bytes) =>
        Paradiso.PrintCess.Core.Protocol.PrintBundle.Parse(bytes);
}

public sealed class PrintBundleException : ProtocolException
{
    public PrintBundleException(string message)
        : base(message)
    {
    }
}
