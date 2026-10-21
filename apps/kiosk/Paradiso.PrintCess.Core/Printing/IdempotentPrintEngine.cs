using Paradiso.PrintCess.Core.Documents;

namespace Paradiso.PrintCess.Core.Printing;

public sealed class IdempotentPrintEngine : IPrintEngine
{
    private readonly IdempotentPrintCoordinator _coordinator;

    public IdempotentPrintEngine(IPrintEngine platformEngine, IPrintSubmissionJournal journal)
    {
        _coordinator = new IdempotentPrintCoordinator(platformEngine, journal);
    }

    public Task<PrintResult> PrintAsync(
        ValidatedDocument document,
        PrintSettings settings,
        CancellationToken cancellationToken,
        Func<CancellationToken, Task>? onReadyToSubmit = null,
        Func<int, CancellationToken, Task<bool>>? authorizeQuotaOverride = null) =>
        _coordinator.PrintOnceAsync(document, settings, cancellationToken, onReadyToSubmit, authorizeQuotaOverride);
}
