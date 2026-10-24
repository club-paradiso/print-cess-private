using System.Buffers.Binary;
using System.Text;

namespace Paradiso.PrintCess.Tests.Fixtures;

internal static class HwpTestDocuments
{
    public static byte[] Valid(
        uint properties = 0,
        bool includeScriptStream = false,
        string scriptStreamName = "Scripts")
    {
        var bytes = new byte[2048];
        new byte[] { 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1 }.CopyTo(bytes, 0);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(0x1c, 2), 0xfffe);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(0x1e, 2), 9);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(0x20, 2), 6);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(0x38, 4), 4096);
        Encoding.Unicode.GetBytes("FileHeader").CopyTo(bytes, 512);
        Encoding.Unicode.GetBytes("DocInfo").CopyTo(bytes, 640);
        Encoding.ASCII.GetBytes("HWP Document File").CopyTo(bytes, 1024);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(1060, 4), properties);
        if (includeScriptStream)
        {
            Encoding.Unicode.GetBytes(scriptStreamName).CopyTo(bytes, 768);
        }
        return bytes;
    }
}
