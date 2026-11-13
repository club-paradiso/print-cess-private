using System.Buffers.Binary;
using System.Text;
using Paradiso.PrintCess.Core.Documents;

namespace Paradiso.PrintCess.Core.Protocol;

public static class BinaryEnvelope
{
    public const int FixedPrefixBytes = 26;
    public const int PublicKeyBytes = 65;
    public const int SaltBytes = 32;
    public const int IvBytes = 12;
    public const int TagBytes = 16;
    public const int HeaderBytes = FixedPrefixBytes + PublicKeyBytes + SaltBytes + IvBytes;
    public const int MaxPlaintextBytes = 10 * 1024 * 1024;
    public const int MaxBundleFiles = 30;
    public const int MaxBundleBytes = 32 * 1024 * 1024;
    public const int MaxEnvelopeBytes = MaxBundleBytes + HeaderBytes + TagBytes;
    public const string HkdfInfo = "print-cess-by-paradiso:file:v1";
    public const string AadDomain = "print-cess-by-paradiso:aad:v1";

    private static ReadOnlySpan<byte> Magic => [0x50, 0x43, 0x45, 0x4e, 0x56, 0x30, 0x31, 0x00];

    public static byte[] CreateHeader(
        DocumentKind fileKind,
        int plaintextLength,
        ReadOnlySpan<byte> ephemeralPublicKey,
        ReadOnlySpan<byte> salt,
        ReadOnlySpan<byte> iv)
    {
        if (!Enum.IsDefined(fileKind) || plaintextLength < 1 || plaintextLength > MaximumPlaintextBytes(fileKind))
        {
            throw new EnvelopeFormatException("Envelope metadata is invalid.");
        }

        if (ephemeralPublicKey.Length != PublicKeyBytes || ephemeralPublicKey[0] != 0x04 ||
            salt.Length != SaltBytes || iv.Length != IvBytes)
        {
            throw new EnvelopeFormatException("Envelope cryptographic field sizes are invalid.");
        }

        var header = new byte[HeaderBytes];
        Magic.CopyTo(header);
        header[8] = ProtocolConstants.Version;
        header[9] = (byte)fileKind;
        BinaryPrimitives.WriteUInt16BigEndian(header.AsSpan(10, 2), 0);
        BinaryPrimitives.WriteUInt16BigEndian(header.AsSpan(12, 2), PublicKeyBytes);
        header[14] = SaltBytes;
        header[15] = IvBytes;
        header[16] = TagBytes;
        header[17] = 0;
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(18, 4), checked((uint)plaintextLength));
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(22, 4), checked((uint)(plaintextLength + TagBytes)));
        ephemeralPublicKey.CopyTo(header.AsSpan(FixedPrefixBytes, PublicKeyBytes));
        salt.CopyTo(header.AsSpan(FixedPrefixBytes + PublicKeyBytes, SaltBytes));
        iv.CopyTo(header.AsSpan(FixedPrefixBytes + PublicKeyBytes + SaltBytes, IvBytes));
        return header;
    }

    public static byte[] Assemble(ReadOnlySpan<byte> header, ReadOnlySpan<byte> ciphertextAndTag)
    {
        if (header.Length != HeaderBytes)
        {
            throw new EnvelopeFormatException("Envelope header length is invalid.");
        }

        var expected = BinaryPrimitives.ReadUInt32BigEndian(header[22..26]);
        if (ciphertextAndTag.Length != expected)
        {
            throw new EnvelopeFormatException("Ciphertext length does not match the header.");
        }

        var envelope = new byte[header.Length + ciphertextAndTag.Length];
        header.CopyTo(envelope);
        ciphertextAndTag.CopyTo(envelope.AsSpan(header.Length));
        return envelope;
    }

    public static ParsedEnvelope Parse(ReadOnlySpan<byte> envelope)
    {
        if (envelope.Length > MaxEnvelopeBytes)
        {
            throw new EnvelopeFormatException("Envelope exceeds the permitted size.");
        }

        if (envelope.Length < FixedPrefixBytes)
        {
            throw new EnvelopeFormatException("Envelope is truncated.");
        }

        if (!envelope[..Magic.Length].SequenceEqual(Magic))
        {
            throw new EnvelopeFormatException("Envelope magic is invalid.");
        }

        var protocolVersion = envelope[8];
        var kindCode = envelope[9];
        var flags = BinaryPrimitives.ReadUInt16BigEndian(envelope[10..12]);
        var publicKeyLength = BinaryPrimitives.ReadUInt16BigEndian(envelope[12..14]);
        var saltLength = envelope[14];
        var ivLength = envelope[15];
        var tagLength = envelope[16];
        var reserved = envelope[17];
        var plaintextLength = BinaryPrimitives.ReadUInt32BigEndian(envelope[18..22]);
        var ciphertextLength = BinaryPrimitives.ReadUInt32BigEndian(envelope[22..26]);

        if (protocolVersion != ProtocolConstants.Version)
        {
            throw new EnvelopeFormatException("Unsupported protocol version.");
        }

        if (flags != 0 || reserved != 0)
        {
            throw new EnvelopeFormatException("Unsupported envelope flags.");
        }

        if (publicKeyLength != PublicKeyBytes || saltLength != SaltBytes || ivLength != IvBytes || tagLength != TagBytes)
        {
            throw new EnvelopeFormatException("Envelope cryptographic field sizes are invalid.");
        }

        var kind = kindCode switch
        {
            (byte)DocumentKind.Pdf => DocumentKind.Pdf,
            (byte)DocumentKind.Jpeg => DocumentKind.Jpeg,
            (byte)DocumentKind.Png => DocumentKind.Png,
            (byte)DocumentKind.Hwpx => DocumentKind.Hwpx,
            (byte)DocumentKind.Hwp => DocumentKind.Hwp,
            (byte)DocumentKind.Bundle => DocumentKind.Bundle,
            _ => throw new EnvelopeFormatException("Envelope file kind is unsupported."),
        };

        if (plaintextLength is 0 || plaintextLength > checked((uint)MaximumPlaintextBytes(kind)) ||
            ciphertextLength != plaintextLength + TagBytes)
        {
            throw new EnvelopeFormatException("Envelope payload sizes are invalid.");
        }

        var expectedLength = (ulong)HeaderBytes + ciphertextLength;
        if (expectedLength != (ulong)envelope.Length)
        {
            throw new EnvelopeFormatException("Envelope length does not match its header.");
        }

        var publicKey = envelope.Slice(FixedPrefixBytes, PublicKeyBytes).ToArray();
        if (publicKey[0] != 0x04)
        {
            throw new EnvelopeFormatException("P-256 public key is not an uncompressed SEC1 point.");
        }

        return new ParsedEnvelope(
            protocolVersion,
            kind,
            checked((int)plaintextLength),
            publicKey,
            envelope.Slice(FixedPrefixBytes + PublicKeyBytes, SaltBytes).ToArray(),
            envelope.Slice(FixedPrefixBytes + PublicKeyBytes + SaltBytes, IvBytes).ToArray(),
            envelope[..HeaderBytes].ToArray(),
            envelope[HeaderBytes..].ToArray());
    }

    public static byte[] BuildAad(AadContext context, ReadOnlySpan<byte> envelopeHeader)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.ProtocolVersion != ProtocolConstants.Version)
        {
            throw new EnvelopeFormatException("Unsupported AAD protocol version.");
        }

        CanonicalEncoding.ValidateSessionId(context.SessionId);
        CanonicalEncoding.ValidateFingerprint(context.KioskPublicKeyFingerprint);
        if (envelopeHeader.Length != HeaderBytes)
        {
            throw new EnvelopeFormatException("Authenticated envelope header length is invalid.");
        }

        var domain = Encoding.UTF8.GetBytes(AadDomain);
        var sessionId = Encoding.UTF8.GetBytes(context.SessionId);
        var fingerprint = Encoding.UTF8.GetBytes(context.KioskPublicKeyFingerprint);
        var aad = new byte[domain.Length + 1 + 1 + sessionId.Length + 1 + fingerprint.Length + envelopeHeader.Length];
        var offset = 0;
        domain.CopyTo(aad, offset);
        offset += domain.Length;
        aad[offset++] = checked((byte)context.ProtocolVersion);
        aad[offset++] = checked((byte)sessionId.Length);
        sessionId.CopyTo(aad, offset);
        offset += sessionId.Length;
        aad[offset++] = checked((byte)fingerprint.Length);
        fingerprint.CopyTo(aad, offset);
        offset += fingerprint.Length;
        envelopeHeader.CopyTo(aad.AsSpan(offset));
        return aad;
    }

    private static int MaximumPlaintextBytes(DocumentKind kind) =>
        kind == DocumentKind.Bundle ? MaxBundleBytes : MaxPlaintextBytes;
}

public sealed record AadContext(
    int ProtocolVersion,
    string SessionId,
    string KioskPublicKeyFingerprint);

public sealed record ParsedEnvelope(
    int ProtocolVersion,
    DocumentKind FileKind,
    int PlaintextLength,
    byte[] EphemeralPublicKey,
    byte[] Salt,
    byte[] Iv,
    byte[] Header,
    byte[] CiphertextAndTag);

public sealed class EnvelopeFormatException : ProtocolException
{
    public EnvelopeFormatException(string message)
        : base(message)
    {
    }
}
