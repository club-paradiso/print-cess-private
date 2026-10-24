using System.IO;
using System.Net;
using System.Net.Http;
using System.Windows;
using Paradiso.PrintCess.Core.Documents;
using Paradiso.PrintCess.Core.Printing;
using Paradiso.PrintCess.Infrastructure.Admin;
using Paradiso.PrintCess.Infrastructure.Http;
using Paradiso.PrintCess.Infrastructure.Printing;
using Paradiso.PrintCess.Infrastructure.Recovery;
using Paradiso.PrintCess.Kiosk.ViewModels;

namespace Paradiso.PrintCess.Kiosk;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        HancomWorkspace.PurgeAbandoned();

        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var journalPath = Path.Combine(localData, "Paradiso", "PrintCess", "print-journal");
        PrintRecoveryReport recovery;
        FilePrintSubmissionJournal? journal = null;
        try
        {
            journal = new FilePrintSubmissionJournal(journalPath);
            recovery = new PrintRecoveryService(journal)
                .RecoverAsync(CancellationToken.None)
                .GetAwaiter()
                .GetResult();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            recovery = new PrintRecoveryReport(false, 0, "RECOVERY-FAILED");
        }
        var authenticator = new Pbkdf2AdminAuthenticator(
            Environment.GetEnvironmentVariable("PRINT_CESS_ADMIN_PASSWORD_HASH"));
        var simulatorRequested = string.Equals(
            Environment.GetEnvironmentVariable("PRINT_CESS_USE_MOCK_PRINT_ENGINE"),
            "true",
            StringComparison.OrdinalIgnoreCase);
        var simulatorEnvironment = string.Equals(
            Environment.GetEnvironmentVariable("PRINT_CESS_ENVIRONMENT"),
            "Development",
            StringComparison.Ordinal);
        var viewModel = new MainViewModel(simulatorRequested && simulatorEnvironment);
        var runtime = recovery.Succeeded && journal is not null
            ? TryCreateRuntime(viewModel, journal, localData, new StaffQuotaAuthorizer(authenticator))
            : null;

        var window = new MainWindow(viewModel, authenticator, recovery, runtime, journal)
        {
            DataContext = viewModel,
        };
        MainWindow = window;
        window.Show();
        if (!recovery.Succeeded)
        {
            viewModel.ApplyRecovery(recovery);
        }
        else if (runtime is null)
        {
            viewModel.Suspend("C-01");
        }
        else
        {
            viewModel.ApplyRecovery(recovery);
        }
    }

    private static KioskRuntimeCoordinator? TryCreateRuntime(
        MainViewModel viewModel,
        IPrintSubmissionJournal journal,
        string localData,
        IStaffQuotaAuthorizer quotaAuthorizer)
    {
        try
        {
            var serverValue = Environment.GetEnvironmentVariable("PRINT_CESS_SERVER_BASE_URL");
            if (!Uri.TryCreate(serverValue, UriKind.Absolute, out var serverUri))
            {
                return null;
            }

            var mockEnabled = string.Equals(
                Environment.GetEnvironmentVariable("PRINT_CESS_USE_MOCK_PRINT_ENGINE"),
                "true",
                StringComparison.OrdinalIgnoreCase);
            var developmentMode = string.Equals(
                Environment.GetEnvironmentVariable("PRINT_CESS_ENVIRONMENT"),
                "Development",
                StringComparison.Ordinal);
            if (mockEnabled && (!developmentMode || !serverUri.IsLoopback))
            {
                return null;
            }

            var printerName = Environment.GetEnvironmentVariable("PRINT_CESS_PRINTER_NAME");
            if (!mockEnabled && string.IsNullOrWhiteSpace(printerName))
            {
                return null;
            }

            printerName = mockEnabled ? "Print-cess Mock Printer" : printerName!;
            var selectionStore = new FilePrinterSelectionStore(
                Path.Combine(localData, "Paradiso", "PrintCess", "printer-selection.json"));
            IPrinterCatalog printerCatalog;
            if (mockEnabled)
            {
                printerCatalog = new FixedPrinterCatalog(printerName, PrinterState.Ready);
            }
            else
            {
                var allowedPrinters = ReadAllowedPrinters(printerName);
                printerCatalog = new WindowsPrinterCatalog(allowedPrinters);
            }

            var availablePrinters = printerCatalog.GetAvailablePrinterNames();
            var persistedPrinter = selectionStore.Load();
            var selectedPrinter = persistedPrinter is not null && availablePrinters.Contains(persistedPrinter, StringComparer.Ordinal)
                ? persistedPrinter
                : availablePrinters.Contains(printerName, StringComparer.Ordinal)
                    ? printerName
                    : null;
            if (selectedPrinter is null)
            {
                return null;
            }

            if (!string.Equals(persistedPrinter, selectedPrinter, StringComparison.Ordinal))
            {
                selectionStore.Save(selectedPrinter);
            }

            var allowedBlobHosts = (Environment.GetEnvironmentVariable("PRINT_CESS_ALLOWED_BLOB_HOSTS") ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (serverUri.IsLoopback)
            {
                allowedBlobHosts.Add(serverUri.IdnHost);
            }

            if (allowedBlobHosts.Count == 0)
            {
                return null;
            }

            var handler = new SocketsHttpHandler
            {
                AllowAutoRedirect = false,
                AutomaticDecompression = DecompressionMethods.None,
                ConnectTimeout = TimeSpan.FromSeconds(10),
                MaxConnectionsPerServer = 4,
                PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            };
            var httpClient = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromSeconds(45),
            };
            var sessionClient = new KioskSessionClient(
                httpClient,
                serverUri,
                Environment.GetEnvironmentVariable("PRINT_CESS_KIOSK_REGISTRATION_SECRET"));
            var adminOperations = new AdminOperationsClient(
                httpClient,
                serverUri,
                Environment.GetEnvironmentVariable("PRINT_CESS_ADMIN_API_SECRET"));
            var downloader = new EncryptedBlobDownloader(
                httpClient,
                allowedBlobHosts,
                allowLoopbackHttp: serverUri.IsLoopback);
            IPrintEngine platformEngine = mockEnabled
                ? new MockPrintEngine(new MockPrintEngineOptions(
                    Enabled: true,
                    ArtifactDirectory: Path.Combine(localData, "Paradiso", "PrintCess", "mock-artifacts")))
                : new WindowsPrintEngine();
            IPrintEngine guardedEngine = new IdempotentPrintEngine(platformEngine, journal);
            return new KioskRuntimeCoordinator(
                viewModel,
                sessionClient,
                downloader,
                new PortableDocumentValidator(),
                guardedEngine,
                PrintSettings.KioskDefault(selectedPrinter),
                httpClient,
                printerCatalog,
                selectionStore,
                adminOperations,
                mockEnabled,
                quotaAuthorizer);
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string[] ReadAllowedPrinters(string configuredPrinter)
    {
        var allowed = (Environment.GetEnvironmentVariable("PRINT_CESS_ALLOWED_PRINTERS") ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(static name => name.Length <= 256 && !name.Any(char.IsControl))
            .Take(32)
            .ToHashSet(StringComparer.Ordinal);
        allowed.Add(configuredPrinter);
        return allowed.ToArray();
    }
}
