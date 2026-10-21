using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using Paradiso.PrintCess.Core.Crypto;
using Paradiso.PrintCess.Core.Documents;
using Paradiso.PrintCess.Core.Printing;
using Paradiso.PrintCess.Core.Protocol;
using Paradiso.PrintCess.Infrastructure.Admin;
using Paradiso.PrintCess.Infrastructure.Http;
using Paradiso.PrintCess.Infrastructure.Printing;
using Paradiso.PrintCess.Kiosk.ViewModels;

namespace Paradiso.PrintCess.Kiosk;

internal sealed class KioskRuntimeCoordinator : IKioskAdminRuntime
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);
    private readonly object _sync = new();
    private readonly MainViewModel _viewModel;
    private readonly KioskSessionClient _sessions;
    private readonly EncryptedBlobDownloader _blobDownloader;
    private readonly IDocumentValidator _validator;
    private readonly IPrintEngine _printEngine;
    private readonly HttpClient _httpClient;
    private readonly IPrinterCatalog _printerCatalog;
    private readonly IPrinterSelectionStore _printerSelectionStore;
    private readonly AdminOperationsClient _adminOperations;
    private readonly bool _usesMockPrinter;
    private readonly IStaffQuotaAuthorizer _quotaAuthorizer;
    private readonly CancellationTokenSource _shutdown = new();
    private PrintSettings _printSettings;
    private CancellationTokenSource? _activeSession;
    private KioskSessionRegistration? _currentRegistration;
    private string? _adminDiscardSessionId;
    private bool _currentSessionConsumed;
    private bool _printerChangeInProgress;
    private DateTimeOffset? _lastServerSuccessUtc;
    private DateTimeOffset? _lastBlobSuccessUtc;
    private DateTimeOffset? _lastCleanupAcknowledgedUtc;
    private AdminServiceHealth _serviceHealth = AdminServiceHealth.NotChecked;
    private bool _disposed;

    public KioskRuntimeCoordinator(
        MainViewModel viewModel,
        KioskSessionClient sessions,
        EncryptedBlobDownloader blobDownloader,
        IDocumentValidator validator,
        IPrintEngine printEngine,
        PrintSettings printSettings,
        HttpClient httpClient,
        IPrinterCatalog printerCatalog,
        IPrinterSelectionStore printerSelectionStore,
        AdminOperationsClient adminOperations,
        bool usesMockPrinter,
        IStaffQuotaAuthorizer quotaAuthorizer)
    {
        _viewModel = viewModel;
        _sessions = sessions;
        _blobDownloader = blobDownloader;
        _validator = validator;
        _printEngine = printEngine;
        _printSettings = printSettings;
        _httpClient = httpClient;
        _printerCatalog = printerCatalog;
        _printerSelectionStore = printerSelectionStore;
        _adminOperations = adminOperations;
        _usesMockPrinter = usesMockPrinter;
        _quotaAuthorizer = quotaAuthorizer;
        _viewModel.FreshSessionRequested += OnFreshSessionRequested;
    }

    public KioskAdminDiagnostics GetDiagnostics()
    {
        KioskAdminDiagnostics snapshot;
        string printerName;
        lock (_sync)
        {
            printerName = _printSettings.PrinterName;
            snapshot = new KioskAdminDiagnostics(
                IsRunning: !_disposed,
                HasActiveSession: _currentRegistration is not null,
                CurrentSessionConsumed: _currentSessionConsumed,
                PrinterName: printerName,
                AvailablePrinterNames: [],
                PrinterState: PrinterState.Unknown,
                UsesMockPrinter: _usesMockPrinter,
                AdminServerOperationsConfigured: _adminOperations.IsConfigured,
                ServiceHealth: _serviceHealth,
                LastServerSuccessUtc: _lastServerSuccessUtc,
                LastBlobSuccessUtc: _lastBlobSuccessUtc,
                LastCleanupAcknowledgedUtc: _lastCleanupAcknowledgedUtc);
        }

        PrinterState printerState;
        IReadOnlyList<string> availablePrinters;
        try
        {
            availablePrinters = _printerCatalog.GetAvailablePrinterNames();
            printerState = _printerCatalog.GetState(printerName);
        }
        catch (Exception exception) when (exception is InvalidOperationException or UnauthorizedAccessException or IOException)
        {
            availablePrinters = [];
            printerState = PrinterState.Unknown;
        }

        return snapshot with { AvailablePrinterNames = availablePrinters, PrinterState = printerState };
    }

    public async Task<AdminServiceHealth> RefreshServiceHealthAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        try
        {
            var health = await _adminOperations.GetHealthAsync(cancellationToken);
            lock (_sync)
            {
                _serviceHealth = health;
            }

            return health;
        }
        catch (AdminOperationsException)
        {
            lock (_sync)
            {
                _serviceHealth = new AdminServiceHealth(
                    AdminProviderStatus.Unavailable,
                    AdminProviderStatus.Unavailable,
                    AdminProviderStatus.Unavailable,
                    AdminProviderStatus.Unavailable,
                    DateTimeOffset.UtcNow);
            }

            throw;
        }
    }

    public async Task<AdminOrphanSweepResult> SweepDueOrphansAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var result = await _adminOperations.SweepDueOrphansAsync(limit, cancellationToken);
        RecordCleanupAcknowledged();
        return result;
    }

    public async Task<KioskPrinterSelectionResult> SelectPrinterAsync(
        string printerName,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        var available = _printerCatalog.GetAvailablePrinterNames();
        if (!available.Contains(printerName, StringComparer.Ordinal))
        {
            throw new InvalidOperationException("The selected printer is not in the approved installed-printer catalog.");
        }

        KioskSessionRegistration? registration;
        CancellationTokenSource? activeSession;
        string currentPrinterName;
        var changeStarted = false;
        lock (_sync)
        {
            currentPrinterName = _printSettings.PrinterName;
            if (string.Equals(currentPrinterName, printerName, StringComparison.Ordinal))
            {
                return new KioskPrinterSelectionResult(false, true, currentPrinterName);
            }

            if (_currentSessionConsumed)
            {
                throw new InvalidOperationException("Printer selection cannot change after encrypted content is consumed.");
            }
            if (_printerChangeInProgress)
            {
                throw new InvalidOperationException("A printer selection change is already in progress.");
            }

            _printerChangeInProgress = true;
            changeStarted = true;
            registration = _currentRegistration;
            activeSession = _activeSession;
            _adminDiscardSessionId = registration?.SessionId;
        }

        try
        {
            try
            {
                activeSession?.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // A concurrently completed waiting session already disposed its cancellation source.
            }

            var cleanupConfirmed = registration is null || await TryCancelAsync(registration);
            cancellationToken.ThrowIfCancellationRequested();
            _printerSelectionStore.Save(printerName);

            lock (_sync)
            {
                _printSettings = PrintSettings.KioskDefault(printerName);
                _printerChangeInProgress = false;
                changeStarted = false;
            }

            _viewModel.RequestFreshSession();
            return new KioskPrinterSelectionResult(true, cleanupConfirmed, printerName);
        }
        finally
        {
            if (changeStarted)
            {
                lock (_sync)
                {
                    _printerChangeInProgress = false;
                }

                _viewModel.RequestFreshSession();
            }
        }
    }

    public async Task<KioskForceDiscardResult> ForceDiscardCurrentSessionAsync()
    {
        KioskSessionRegistration? registration;
        bool consumed;
        CancellationTokenSource? activeSession;
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            registration = _currentRegistration;
            consumed = _currentSessionConsumed;
            activeSession = _activeSession;
            _adminDiscardSessionId = registration?.SessionId;
        }

        try
        {
            activeSession?.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // A concurrently completed session already disposed its cancellation source.
        }

        var cleanupConfirmed = registration is null || await TryFinishFailedAsync(registration, consumed);
        _viewModel.RequestFreshSession();
        return new KioskForceDiscardResult(registration is not null, cleanupConfirmed);
    }

    public async Task<PrintResult> PrintTestPageAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        PrintSettings printSettings;
        lock (_sync)
        {
            printSettings = _printSettings;
        }

        byte[]? pageBytes = null;
        byte[]? idempotencyBytes = null;
        try
        {
            pageBytes = AdminTestPageFactory.CreatePng(printSettings.PrinterName, DateTimeOffset.Now);
            idempotencyBytes = RandomNumberGenerator.GetBytes(16);
            var idempotencyKey = CanonicalEncoding.EncodeBase64Url(idempotencyBytes);
            using var document = _validator.Validate(
                pageBytes,
                DocumentKind.Png,
                DocumentKind.Png.CanonicalMimeType(),
                idempotencyKey);
            return await _printEngine.PrintAsync(document, printSettings, cancellationToken);
        }
        finally
        {
            if (pageBytes is not null)
            {
                CryptographicOperations.ZeroMemory(pageBytes);
            }

            if (idempotencyBytes is not null)
            {
                CryptographicOperations.ZeroMemory(idempotencyBytes);
            }
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.FreshSessionRequested -= OnFreshSessionRequested;
        _shutdown.Cancel();
        KioskSessionRegistration? registration;
        bool consumed;
        lock (_sync)
        {
            _activeSession?.Cancel();
            _activeSession?.Dispose();
            _activeSession = null;
            registration = _currentRegistration;
            consumed = _currentSessionConsumed;
        }

        if (registration is not null && !consumed)
        {
            try
            {
                _ = Task.Run(() => TryCancelAsync(registration)).GetAwaiter().GetResult();
            }
            catch (Exception exception) when (exception is KioskApiException or OperationCanceledException)
            {
                // Server TTL/QStash remains the bounded cleanup fallback during shutdown.
            }
        }

        _shutdown.Dispose();
        _httpClient.Dispose();
    }

    private void OnFreshSessionRequested(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        var next = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token);
        CancellationTokenSource? previous;
        lock (_sync)
        {
            previous = _activeSession;
            _activeSession = next;
        }

        previous?.Cancel();
        previous?.Dispose();
        _ = RunSessionAsync(next.Token);
    }

    private async Task RunSessionAsync(CancellationToken cancellationToken)
    {
        KioskSessionRegistration? registration = null;
        var consumed = false;
        try
        {
            using var kioskKey = KioskSessionKey.Generate();
            registration = await _sessions.CreateAsync(
                kioskKey.PublicKeyBase64Url,
                kioskKey.PublicKeyFingerprint,
                cancellationToken);
            RecordServerSuccess(registration, consumed: false);
            var qrImage = QrCodeImageFactory.Create(registration.QrUrl);
            _viewModel.ShowWaiting(
                qrImage,
                DateTimeOffset.FromUnixTimeMilliseconds(registration.ExpiresAt));

            while (!cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(PollInterval, cancellationToken);
                var status = await _sessions.GetStatusAsync(
                    registration.SessionId,
                    registration.KioskToken,
                    cancellationToken);
                RecordServerSuccess();
                if (status.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() &&
                    status.Status is PrintSessionStatus.Waiting or
                        PrintSessionStatus.Claimed or
                        PrintSessionStatus.UploadAuthorized or
                        PrintSessionStatus.Uploading or
                        PrintSessionStatus.Uploaded)
                {
                    _viewModel.RequestFreshSession();
                    return;
                }

                switch (status.Status)
                {
                    case PrintSessionStatus.Waiting:
                        break;
                    case PrintSessionStatus.Claimed:
                        _viewModel.ShowClaimed();
                        break;
                    case PrintSessionStatus.UploadAuthorized:
                    case PrintSessionStatus.Uploading:
                        _viewModel.ShowUploading();
                        break;
                    case PrintSessionStatus.Uploaded:
                        if (!TryRecordConsumed(registration))
                        {
                            await TryCancelAsync(registration);
                            return;
                        }

                        consumed = true;
                        await ConsumeValidateAndPrintAsync(registration, kioskKey, cancellationToken);
                        return;
                    case PrintSessionStatus.Expired:
                    case PrintSessionStatus.Cancelled:
                    case PrintSessionStatus.Failed:
                        _viewModel.RequestFreshSession();
                        return;
                    default:
                        throw new KioskApiException("Server returned an unexpected kiosk session state.");
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            if (registration is not null && !consumed && !_shutdown.IsCancellationRequested && !IsAdminDiscard(registration))
            {
                await TryCancelAsync(registration);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            bool? cleanupConfirmed = null;
            if (registration is not null)
            {
                cleanupConfirmed = await TryFinishFailedAsync(registration, consumed);
            }

            if (consumed && IsVisitorDocumentFailure(exception))
            {
                var message = DocumentErrorMessage(exception);
                _viewModel.ShowSessionError(message.Primary, message.NextAction, cleanupConfirmed ?? false);
            }
            else
            {
                _viewModel.Suspend(CodeFor(exception), cleanupConfirmed);
            }
        }
        finally
        {
            if (registration is not null)
            {
                ClearCurrentRegistration(registration);
            }
        }
    }

    private async Task ConsumeValidateAndPrintAsync(
        KioskSessionRegistration registration,
        KioskSessionKey kioskKey,
        CancellationToken cancellationToken)
    {
        var consumeNonce = RandomNumberGenerator.GetBytes(32);
        string consumeIdHash;
        try
        {
            consumeIdHash = CanonicalEncoding.EncodeBase64Url(SHA256.HashData(consumeNonce));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(consumeNonce);
        }

        var lease = await _sessions.ConsumeAsync(
            registration.SessionId,
            registration.KioskToken,
            consumeIdHash,
            cancellationToken);
        RecordServerSuccess();
        if (!Uri.TryCreate(lease.Url, UriKind.Absolute, out var downloadUri))
        {
            throw new KioskApiException("Encrypted download URL is invalid.");
        }

        var envelope = await _blobDownloader.DownloadAsync(
            downloadUri,
            lease.Headers,
            lease.Size,
            lease.Etag,
            cancellationToken);
        RecordBlobSuccess();
        try
        {
            if (envelope.Length != lease.Size)
            {
                throw new EnvelopeFormatException("Encrypted blob size did not match the consume lease.");
            }

            await _sessions.TransitionAsync(
                registration.SessionId,
                registration.KioskToken,
                PrintSessionStatus.Validating,
                cancellationToken);
            RecordServerSuccess();
            _viewModel.ShowValidating();
            using var decrypted = EncryptedDocumentDecryptor.Decrypt(
                envelope,
                new AadContext(ProtocolConstants.Version, registration.SessionId, kioskKey.PublicKeyFingerprint),
                kioskKey);
            using var document = _validator.Validate(
                decrypted.Bytes,
                decrypted.Kind,
                decrypted.Kind.CanonicalMimeType(),
                registration.SessionId);

            PrintSettings printSettings;
            lock (_sync)
            {
                printSettings = _printSettings;
            }

            var printResult = await _printEngine.PrintAsync(
                document,
                printSettings,
                cancellationToken,
                async readyCancellationToken =>
                {
                    await _sessions.TransitionAsync(
                        registration.SessionId,
                        registration.KioskToken,
                        PrintSessionStatus.Printing,
                        readyCancellationToken);
                    RecordServerSuccess();
                    _viewModel.ShowPrinting();
                },
                _quotaAuthorizer.AuthorizeAsync);
            if (!printResult.WasSubmitted)
            {
                var failedCleanupConfirmed = await TryTransitionFailedAsync(registration);
                if (string.Equals(printResult.Code, "F-01", StringComparison.Ordinal))
                {
                    _viewModel.ShowSessionError(
                        "이 문서를 안전하게 열 수 없습니다",
                        "휴대전화에서 파일을 다시 저장한 뒤 새 QR로 다시 보내세요",
                        failedCleanupConfirmed);
                }
                else if (string.Equals(printResult.Code, "Q-01", StringComparison.Ordinal))
                {
                    _viewModel.ShowSessionError(
                        "직원 승인이 없어 출력을 취소했습니다",
                        "11페이지 이하로 다시 고르거나 직원에게 승인을 요청하세요",
                        failedCleanupConfirmed);
                }
                else if (string.Equals(printResult.Code, "Q-02", StringComparison.Ordinal))
                {
                    _viewModel.ShowSessionError(
                        "시스템 최대 출력량 50페이지를 넘었습니다",
                        "50페이지 이하로 나누어 새 QR로 다시 보내세요. 이건 구독으로도 안 돼요",
                        failedCleanupConfirmed);
                }
                else
                {
                    _viewModel.Suspend(printResult.Code, failedCleanupConfirmed);
                }

                return;
            }

            var cleanupConfirmed = true;
            try
            {
                await _sessions.TransitionAsync(
                    registration.SessionId,
                    registration.KioskToken,
                    PrintSessionStatus.Completed,
                    cancellationToken);
                RecordCleanupAcknowledged();
            }
            catch (KioskApiException)
            {
                // The spooler accepted the guarded job. Server TTL/QStash remain the cleanup fallback.
                cleanupConfirmed = false;
            }

            _viewModel.ShowCompleted(cleanupConfirmed);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(envelope);
        }
    }

    private async Task<bool> TryFinishFailedAsync(KioskSessionRegistration registration, bool consumed)
    {
        if (consumed)
        {
            return await TryTransitionFailedAsync(registration);
        }

        return await TryCancelAsync(registration);
    }

    private async Task<bool> TryTransitionFailedAsync(KioskSessionRegistration registration)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            await _sessions.TransitionAsync(
                registration.SessionId,
                registration.KioskToken,
                PrintSessionStatus.Failed,
                timeout.Token);
            RecordCleanupAcknowledged();
            return true;
        }
        catch (Exception exception) when (exception is KioskApiException or OperationCanceledException)
        {
            // Explicit cleanup failed; server-side delayed cleanup and TTL remain in force.
            return false;
        }
    }

    private async Task<bool> TryCancelAsync(KioskSessionRegistration registration)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            await _sessions.CancelAsync(registration.SessionId, registration.KioskToken, timeout.Token);
            RecordCleanupAcknowledged();
            return true;
        }
        catch (Exception exception) when (exception is KioskApiException or OperationCanceledException)
        {
            // Server-side delayed cleanup and TTL remain in force.
            return false;
        }
    }

    private static bool IsVisitorDocumentFailure(Exception exception) =>
        exception is EnvelopeDecryptionException or EnvelopeFormatException or DocumentValidationException or CryptographicException;

    private static (string Primary, string NextAction) DocumentErrorMessage(Exception exception) => exception switch
    {
        DocumentValidationException { Error: DocumentValidationError.LockedPdf } =>
            ("암호가 설정된 PDF는 인쇄할 수 없습니다", "휴대전화에서 필요한 페이지를 화면 캡처한 뒤 새 QR로 다시 보내세요"),
        DocumentValidationException { Error: DocumentValidationError.TooManyPages } =>
            ("시스템 최대 출력량 50페이지를 넘었습니다", "50페이지 이하로 나누어 새 QR로 다시 보내세요. 이건 구독으로도 안 돼요"),
        DocumentValidationException { Error: DocumentValidationError.TypeMismatch or DocumentValidationError.MimeMismatch } =>
            ("PDF, JPG, PNG 파일만 인쇄할 수 있습니다", "지원 형식으로 저장하거나 선명한 화면 캡처를 새 QR로 보내세요"),
        DocumentValidationException =>
            ("이 문서를 안전하게 열 수 없습니다", "휴대전화에서 파일을 다시 저장한 뒤 새 QR로 다시 보내세요"),
        _ =>
            ("전송된 문서를 안전하게 확인할 수 없습니다", "새 QR이 나타나면 휴대전화에서 파일을 다시 보내세요"),
    };

    private static string CodeFor(Exception exception) => exception switch
    {
        EnvelopeDecryptionException => "S-02",
        DocumentValidationException => "F-01",
        CryptographicException => "S-02",
        _ => "N-01",
    };

    private void RecordServerSuccess(KioskSessionRegistration? registration = null, bool consumed = false)
    {
        lock (_sync)
        {
            _lastServerSuccessUtc = DateTimeOffset.UtcNow;
            if (registration is not null)
            {
                _currentRegistration = registration;
                _currentSessionConsumed = consumed;
            }
        }
    }

    private bool TryRecordConsumed(KioskSessionRegistration registration)
    {
        lock (_sync)
        {
            if (_printerChangeInProgress ||
                !string.Equals(_currentRegistration?.SessionId, registration.SessionId, StringComparison.Ordinal))
            {
                return false;
            }

            _currentSessionConsumed = true;
            return true;
        }
    }

    private void RecordBlobSuccess()
    {
        lock (_sync)
        {
            _lastBlobSuccessUtc = DateTimeOffset.UtcNow;
        }
    }

    private void RecordCleanupAcknowledged()
    {
        lock (_sync)
        {
            _lastServerSuccessUtc = DateTimeOffset.UtcNow;
            _lastCleanupAcknowledgedUtc = _lastServerSuccessUtc;
        }
    }

    private bool IsAdminDiscard(KioskSessionRegistration registration)
    {
        lock (_sync)
        {
            return string.Equals(_adminDiscardSessionId, registration.SessionId, StringComparison.Ordinal);
        }
    }

    private void ClearCurrentRegistration(KioskSessionRegistration registration)
    {
        lock (_sync)
        {
            if (string.Equals(_currentRegistration?.SessionId, registration.SessionId, StringComparison.Ordinal))
            {
                _currentRegistration = null;
                _currentSessionConsumed = false;
            }

            if (string.Equals(_adminDiscardSessionId, registration.SessionId, StringComparison.Ordinal))
            {
                _adminDiscardSessionId = null;
            }
        }
    }
}
