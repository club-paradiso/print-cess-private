using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Paradiso.PrintCess.Core.Protocol;
using Paradiso.PrintCess.Infrastructure.Printing;

namespace Paradiso.PrintCess.Infrastructure.Http;

public sealed class KioskSessionClient
{
    private const int MaximumJsonResponseBytes = 32 * 1024;
    private readonly HttpClient _httpClient;
    private readonly Uri _serverBaseUri;
    private readonly string? _registrationSecret;
    private readonly JsonSerializerOptions _jsonOptions = ProtocolJson.CreateOptions();

    public KioskSessionClient(HttpClient httpClient, Uri serverBaseUri, string? registrationSecret)
    {
        _httpClient = httpClient;
        _serverBaseUri = ValidateServerBaseUri(serverBaseUri);
        _registrationSecret = string.IsNullOrWhiteSpace(registrationSecret) ? null : registrationSecret;
    }

    public async Task<KioskSessionRegistration> CreateAsync(
        string kioskPublicKey,
        string kioskPublicKeyFingerprint,
        CancellationToken cancellationToken)
    {
        CanonicalEncoding.ValidatePublicKey(kioskPublicKey);
        CanonicalEncoding.ValidateFingerprint(kioskPublicKeyFingerprint);
        using var request = CreateJsonRequest(
            HttpMethod.Post,
            "api/sessions",
            new CreateSessionRequest(
                ProtocolConstants.Version,
                kioskPublicKey,
                kioskPublicKeyFingerprint,
                HancomHwpxRenderer.IsAvailable,
                HancomHwpxRenderer.IsAvailable,
                SupportsPrintBundles: true));
        if (_registrationSecret is not null)
        {
            request.Headers.TryAddWithoutValidation("x-kiosk-registration-secret", _registrationSecret);
        }

        var registration = await SendAsync<KioskSessionRegistration>(request, cancellationToken).ConfigureAwait(false);
        if (registration.ProtocolVersion != ProtocolConstants.Version || registration.Status != PrintSessionStatus.Waiting)
        {
            throw new KioskApiException("Session registration returned an invalid protocol state.");
        }

        CanonicalEncoding.ValidateSessionId(registration.SessionId);
        ValidateCredential(registration.KioskToken, "Kiosk session credential is invalid.");
        if (registration.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
        {
            throw new KioskApiException("Session registration is already expired.");
        }

        ValidateQrUrl(registration.QrUrl, registration.SessionId, kioskPublicKeyFingerprint);
        return registration;
    }

    public async Task<KioskSessionStatus> GetStatusAsync(
        string sessionId,
        string kioskToken,
        CancellationToken cancellationToken)
    {
        using var request = CreateAuthorizedRequest(HttpMethod.Get, $"api/sessions/{Segment(sessionId)}/status", kioskToken);
        var status = await SendAsync<KioskSessionStatus>(request, cancellationToken).ConfigureAwait(false);
        if (status.ProtocolVersion != ProtocolConstants.Version || !string.Equals(status.SessionId, sessionId, StringComparison.Ordinal))
        {
            throw new KioskApiException("Session status response did not match the active session.");
        }

        if (status.ExpiresAt <= 0)
        {
            throw new KioskApiException("Session status response has an invalid expiry.");
        }

        return status;
    }

    public async Task<EncryptedDownloadLease> ConsumeAsync(
        string sessionId,
        string kioskToken,
        string consumeIdHash,
        CancellationToken cancellationToken)
    {
        CanonicalEncoding.ValidateFingerprint(consumeIdHash);
        using var request = CreateJsonRequest(
            HttpMethod.Post,
            $"api/sessions/{Segment(sessionId)}/consume",
            new ConsumeSessionRequest(consumeIdHash));
        AddKioskToken(request, kioskToken);
        var lease = await SendAsync<EncryptedDownloadLease>(request, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(lease.SessionId, sessionId, StringComparison.Ordinal) ||
            lease.Status != PrintSessionStatus.Consumed ||
            !string.Equals(lease.Method, "GET", StringComparison.Ordinal) ||
            lease.Size is <= BinaryEnvelope.HeaderBytes + BinaryEnvelope.TagBytes or > BinaryEnvelope.MaxEnvelopeBytes ||
            lease.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
        {
            throw new KioskApiException("Encrypted download lease is invalid.");
        }

        return lease;
    }

    public async Task TransitionAsync(
        string sessionId,
        string kioskToken,
        PrintSessionStatus status,
        CancellationToken cancellationToken)
    {
        if (status is not (PrintSessionStatus.Validating or PrintSessionStatus.Printing or PrintSessionStatus.Completed or PrintSessionStatus.Failed))
        {
            throw new ArgumentOutOfRangeException(nameof(status));
        }

        using var request = CreateJsonRequest(
            HttpMethod.Post,
            $"api/sessions/{Segment(sessionId)}/transition",
            new KioskTransitionRequest(status));
        AddKioskToken(request, kioskToken);
        var response = await SendAsync<KioskTransitionResponse>(request, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(response.SessionId, sessionId, StringComparison.Ordinal) || response.Status != status)
        {
            throw new KioskApiException("Session transition response did not match the request.");
        }
    }

    public async Task CancelAsync(string sessionId, string kioskToken, CancellationToken cancellationToken)
    {
        using var request = CreateAuthorizedRequest(
            HttpMethod.Post,
            $"api/sessions/{Segment(sessionId)}/cancel",
            kioskToken);
        var response = await SendAsync<KioskTransitionResponse>(request, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(response.SessionId, sessionId, StringComparison.Ordinal) ||
            response.Status != PrintSessionStatus.Cancelled)
        {
            throw new KioskApiException("Session cancellation response did not match the request.");
        }
    }

    private HttpRequestMessage CreateAuthorizedRequest(HttpMethod method, string path, string kioskToken)
    {
        var request = new HttpRequestMessage(method, new Uri(_serverBaseUri, path));
        AddOrigin(request);
        AddKioskToken(request, kioskToken);
        return request;
    }

    private HttpRequestMessage CreateJsonRequest<T>(HttpMethod method, string path, T value)
    {
        var request = new HttpRequestMessage(method, new Uri(_serverBaseUri, path));
        AddOrigin(request);
        var json = JsonSerializer.Serialize(value, _jsonOptions);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return request;
    }

    private async Task<T> SendAsync<T>(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception exception) when (
            exception is HttpRequestException ||
            (exception is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            throw new KioskApiException("Kiosk API request failed.", exception);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new KioskApiException($"Kiosk API returned status {(int)response.StatusCode}.");
            }

            if (response.Content.Headers.ContentLength is > MaximumJsonResponseBytes)
            {
                throw new KioskApiException("Kiosk API response is too large.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var limited = new MemoryStream();
            var buffer = new byte[4 * 1024];
            while (true)
            {
                var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (read == 0)
                {
                    break;
                }

                if (limited.Length + read > MaximumJsonResponseBytes)
                {
                    throw new KioskApiException("Kiosk API response is too large.");
                }

                await limited.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }

            try
            {
                return JsonSerializer.Deserialize<T>(limited.GetBuffer().AsSpan(0, checked((int)limited.Length)), _jsonOptions)
                    ?? throw new KioskApiException("Kiosk API response was empty.");
            }
            catch (JsonException exception)
            {
                throw new KioskApiException("Kiosk API response did not match protocol v1.", exception);
            }
        }
    }

    private void AddOrigin(HttpRequestMessage request) =>
        request.Headers.TryAddWithoutValidation("Origin", _serverBaseUri.GetLeftPart(UriPartial.Authority));

    private static void AddKioskToken(HttpRequestMessage request, string kioskToken)
    {
        ValidateCredential(kioskToken, "Kiosk session credential is invalid.");
        request.Headers.TryAddWithoutValidation("x-print-cess-kiosk-token", kioskToken);
    }

    private static string Segment(string sessionId)
    {
        CanonicalEncoding.ValidateSessionId(sessionId);
        return Uri.EscapeDataString(sessionId);
    }

    private void ValidateQrUrl(string value, string sessionId, string expectedFingerprint)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var qrUri) ||
            !string.Equals(qrUri.Scheme, _serverBaseUri.Scheme, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(qrUri.Authority, _serverBaseUri.Authority, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(qrUri.AbsolutePath, $"/s/{sessionId}", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(qrUri.Query) ||
            !string.IsNullOrEmpty(qrUri.UserInfo) ||
            !TryReadQrFragment(qrUri.Fragment, out var uploadToken, out var fingerprint) ||
            !string.Equals(fingerprint, expectedFingerprint, StringComparison.Ordinal))
        {
            throw new KioskApiException("Session QR URL is invalid.");
        }

        ValidateCredential(uploadToken, "Session QR URL is invalid.");
        ValidateCredential(fingerprint, "Session QR URL is invalid.");
    }

    private static bool TryReadQrFragment(string fragment, out string uploadToken, out string fingerprint)
    {
        uploadToken = string.Empty;
        fingerprint = string.Empty;
        if (!fragment.StartsWith('#'))
        {
            return false;
        }

        var pairs = fragment[1..].Split('&', StringSplitOptions.None);
        if (pairs.Length is < 2 or > 5)
        {
            return false;
        }

        var capabilities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pair in pairs)
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0 || separator == pair.Length - 1)
            {
                return false;
            }

            var name = pair[..separator];
            var value = pair[(separator + 1)..];
            if (name == "t" && uploadToken.Length == 0)
            {
                uploadToken = value;
            }
            else if (name == "fp" && fingerprint.Length == 0)
            {
                fingerprint = value;
            }
            else if ((name == "hwpx" || name == "hwp" || name == "bundle") &&
                     value == "1" && capabilities.Add(name))
            {
            }
            else
            {
                return false;
            }
        }

        return uploadToken.Length > 0 && fingerprint.Length > 0;
    }

    private static void ValidateCredential(string? value, string safeMessage)
    {
        if (string.IsNullOrEmpty(value))
        {
            throw new KioskApiException(safeMessage);
        }

        try
        {
            CanonicalEncoding.ValidateFingerprint(value);
        }
        catch (ProtocolException exception)
        {
            throw new KioskApiException(safeMessage, exception);
        }
    }

    private static Uri ValidateServerBaseUri(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!uri.IsAbsoluteUri || (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)))
        {
            throw new ArgumentException("Kiosk server must use HTTPS, except for loopback development.", nameof(uri));
        }

        return new Uri(uri.GetLeftPart(UriPartial.Authority) + "/", UriKind.Absolute);
    }
}

public sealed record KioskSessionRegistration(
    [property: JsonPropertyName("protocolVersion")] int ProtocolVersion,
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("status")] PrintSessionStatus Status,
    [property: JsonPropertyName("expiresAt")] long ExpiresAt,
    [property: JsonPropertyName("kioskToken")] string KioskToken,
    [property: JsonPropertyName("qrUrl")] string QrUrl);

public sealed record KioskSessionStatus(
    [property: JsonPropertyName("protocolVersion")] int ProtocolVersion,
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("status")] PrintSessionStatus Status,
    [property: JsonPropertyName("expiresAt")] long ExpiresAt);

public sealed record ConsumeSessionRequest(
    [property: JsonPropertyName("consumeIdHash")] string ConsumeIdHash);

public sealed record EncryptedDownloadLease(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("status")] PrintSessionStatus Status,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("headers")] Dictionary<string, string> Headers,
    [property: JsonPropertyName("expiresAt")] long ExpiresAt,
    [property: JsonPropertyName("etag")] string Etag,
    [property: JsonPropertyName("size")] int Size);

public sealed record KioskTransitionResponse(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("status")] PrintSessionStatus Status,
    [property: JsonPropertyName("completedAt")] long? CompletedAt = null);

public sealed class KioskApiException : IOException
{
    public KioskApiException(string message)
        : base(message)
    {
    }

    public KioskApiException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
