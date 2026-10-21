using System.Security.Cryptography;
using Paradiso.PrintCess.Core.Protocol;

namespace Paradiso.PrintCess.Core.Crypto;

public sealed class KioskSessionKey : IDisposable
{
    private readonly ECDiffieHellman _key;
    private bool _disposed;

    private KioskSessionKey(ECDiffieHellman key)
    {
        _key = key;
        PublicKey = ExportRawPublicKey(key);
        PublicKeyFingerprint = CanonicalEncoding.EncodeBase64Url(SHA256.HashData(PublicKey));
    }

    public byte[] PublicKey { get; }

    public string PublicKeyBase64Url => CanonicalEncoding.EncodeBase64Url(PublicKey);

    public string PublicKeyFingerprint { get; }

    public static KioskSessionKey Generate() => new(ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256));

    public static KioskSessionKey ImportForTest(ReadOnlySpan<byte> privateScalar, ReadOnlySpan<byte> publicKey)
    {
        if (privateScalar.Length != 32 || publicKey.Length != BinaryEnvelope.PublicKeyBytes || publicKey[0] != 0x04)
        {
            throw new CryptographicException("Invalid P-256 test key material.");
        }

        var key = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = privateScalar.ToArray(),
            Q = new ECPoint
            {
                X = publicKey.Slice(1, 32).ToArray(),
                Y = publicKey.Slice(33, 32).ToArray(),
            },
        });
        return new KioskSessionKey(key);
    }

    internal byte[] DeriveRawSecret(ReadOnlySpan<byte> peerPublicKey)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (peerPublicKey.Length != BinaryEnvelope.PublicKeyBytes || peerPublicKey[0] != 0x04)
        {
            throw new CryptographicException("Invalid uncompressed P-256 public key.");
        }

        ECDiffieHellman peer;
        try
        {
            peer = ECDiffieHellman.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint
                {
                    X = peerPublicKey.Slice(1, 32).ToArray(),
                    Y = peerPublicKey.Slice(33, 32).ToArray(),
                },
            });
        }
        catch (PlatformNotSupportedException exception) when (exception.InnerException is CryptographicException)
        {
            // Windows CNG reports an off-curve peer point as PlatformNotSupportedException,
            // while OpenSSL reports CryptographicException. Normalize the invalid input so
            // callers classify the tampered envelope consistently on both platforms.
            throw new CryptographicException("Invalid uncompressed P-256 public key.", exception);
        }

        using (peer)
        {
            var secret = _key.DeriveRawSecretAgreement(peer.PublicKey);
            if (secret.Length != 32)
            {
                CryptographicOperations.ZeroMemory(secret);
                throw new CryptographicException("P-256 produced an unexpected shared-secret length.");
            }

            return secret;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CryptographicOperations.ZeroMemory(PublicKey);
        _key.Dispose();
    }

    private static byte[] ExportRawPublicKey(ECDiffieHellman key)
    {
        var parameters = key.ExportParameters(false);
        if (parameters.Q.X is not { Length: 32 } x || parameters.Q.Y is not { Length: 32 } y)
        {
            throw new CryptographicException("P-256 returned an invalid public key.");
        }

        var raw = new byte[BinaryEnvelope.PublicKeyBytes];
        raw[0] = 0x04;
        x.CopyTo(raw, 1);
        y.CopyTo(raw, 33);
        return raw;
    }
}
