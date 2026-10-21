#if WINDOWS
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;
using Microsoft.Win32;
using Paradiso.PrintCess.Core.Documents;

namespace Paradiso.PrintCess.Infrastructure.Printing;

internal static class HancomHwpxRenderer
{
    private const int MaximumRenderedPdfBytes = 64 * 1024 * 1024;
    private const string SecurityModuleEnvironmentVariable = "PRINT_CESS_HANCOM_SECURITY_MODULE";
    private const string DefaultSecurityModuleName = "FilePathCheckerModuleExample";
    private const string SecurityModuleRegistryPath = @"Software\HNC\HwpAutomation\Modules";

    public static bool IsAvailable =>
        GetAutomationType() is not null && ResolveSecurityModuleName() is not null;

    public static Task<byte[]> RenderToPdfAsync(
        byte[] content,
        DocumentKind kind,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (kind is not (DocumentKind.Hwp or DocumentKind.Hwpx))
        {
            throw new ArgumentOutOfRangeException(nameof(kind));
        }
        cancellationToken.ThrowIfCancellationRequested();

        var moduleName = ResolveSecurityModuleName();
        if (string.IsNullOrWhiteSpace(moduleName))
        {
            throw new InvalidDataException(
                $"No usable Hancom Automation file-path security module is registered under HKCU\\{SecurityModuleRegistryPath}. " +
                $"Register '{DefaultSecurityModuleName}' or set {SecurityModuleEnvironmentVariable} to the exact registered value name.");
        }

        var directory = Path.Combine(Path.GetTempPath(), "PrintCess", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var extension = kind == DocumentKind.Hwp ? "hwp" : "hwpx";
        var inputPath = Path.Combine(directory, $"document.{extension}");
        var outputPath = Path.Combine(directory, "document.pdf");
        object? automation = null;

        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            File.WriteAllBytes(inputPath, content);

            var automationType = GetAutomationType();
            if (automationType is null)
            {
                throw new InvalidDataException("A supported Hancom Office automation component is not installed.");
            }

            automation = Activator.CreateInstance(automationType) ??
                         throw new InvalidDataException("Hancom Office automation could not be started.");

            var registered = Invoke(automation, "RegisterModule", "FilePathCheckDLL", moduleName);
            if (registered is not bool registeredResult || !registeredResult)
            {
                throw new InvalidDataException(
                    $"Hancom rejected security module '{moduleName}'. Verify the HKCU Automation module registration and DLL path.");
            }

            cancellationToken.ThrowIfCancellationRequested();
            // Let Hancom detect the real document format. This is more robust than forcing
            // HWP/HWPX from the extension and is the vendor-recommended behavior when the
            // exact underlying format is not guaranteed by the filename alone.
            var opened = Invoke(
                automation,
                "Open",
                inputPath,
                string.Empty,
                "lock:false;forceopen:true;suspendpassword:true;versionwarning:false;");
            if (opened is bool openedResult && !openedResult)
            {
                throw new InvalidDataException("Hancom Office rejected the Hangul document.");
            }

            cancellationToken.ThrowIfCancellationRequested();
            var saved = Invoke(automation, "SaveAs", outputPath, "PDF", string.Empty);
            if (saved is bool savedResult && !savedResult)
            {
                throw new InvalidDataException("Hancom Office could not render the Hangul document as PDF.");
            }

            if (!File.Exists(outputPath))
            {
                throw new InvalidDataException("Hancom Office did not create a PDF output file.");
            }

            var info = new FileInfo(outputPath);
            if (info.Length is < 1 or > MaximumRenderedPdfBytes)
            {
                throw new InvalidDataException("The rendered PDF is outside the safe size limit.");
            }

            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(File.ReadAllBytes(outputPath));
        }
        catch (Exception exception) when (exception is COMException or TargetInvocationException or
                                          MissingMethodException or UnauthorizedAccessException or
                                          SecurityException or IOException)
        {
            throw new InvalidDataException("Hangul document rendering failed safely.", exception);
        }
        finally
        {
            if (automation is not null)
            {
                TryInvoke(automation, "Clear", 1);
                TryInvoke(automation, "Quit");
                if (Marshal.IsComObject(automation))
                {
                    Marshal.FinalReleaseComObject(automation);
                }
            }

            SecureDelete(inputPath);
            SecureDelete(outputPath);
            try
            {
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, recursive: true);
                }
            }
            catch
            {
                // The application-owned cleanup job retries abandoned temporary directories.
            }
        }
    }

    private static Type? GetAutomationType() =>
        Type.GetTypeFromProgID("HWPFrame.HwpObject.2", throwOnError: false) ??
        Type.GetTypeFromProgID("HWPFrame.HwpObject", throwOnError: false);

    private static string? ResolveSecurityModuleName()
    {
        var configuredName = Environment.GetEnvironmentVariable(SecurityModuleEnvironmentVariable)?.Trim();
        if (!string.IsNullOrWhiteSpace(configuredName))
        {
            return IsSecurityModuleRegistered(configuredName) ? configuredName : null;
        }

        return IsSecurityModuleRegistered(DefaultSecurityModuleName)
            ? DefaultSecurityModuleName
            : null;
    }

    private static bool IsSecurityModuleRegistered(string moduleName) =>
        TryFindSecurityModule(moduleName, RegistryView.Registry64) ||
        TryFindSecurityModule(moduleName, RegistryView.Registry32);

    private static bool TryFindSecurityModule(string moduleName, RegistryView view)
    {
        try
        {
            using var currentUser = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view);
            using var modules = currentUser.OpenSubKey(SecurityModuleRegistryPath, writable: false);
            var registeredPath = modules?.GetValue(
                moduleName,
                defaultValue: null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            if (string.IsNullOrWhiteSpace(registeredPath))
            {
                return false;
            }

            var expandedPath = Environment.ExpandEnvironmentVariables(registeredPath.Trim());
            return Path.IsPathFullyQualified(expandedPath) && File.Exists(expandedPath);
        }
        catch (Exception exception) when (exception is SecurityException or UnauthorizedAccessException or IOException)
        {
            return false;
        }
    }

    private static object? Invoke(object target, string method, params object?[] arguments) =>
        target.GetType().InvokeMember(
            method,
            BindingFlags.InvokeMethod | BindingFlags.Public | BindingFlags.Instance,
            binder: null,
            target,
            arguments,
            CultureInfo.InvariantCulture);

    private static void TryInvoke(object target, string method, params object?[] arguments)
    {
        try
        {
            Invoke(target, method, arguments);
        }
        catch
        {
            // Cleanup must continue even when the automation object is already shutting down.
        }
    }

    private static void SecureDelete(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return;
            }

            var length = new FileInfo(path).Length;
            if (length is > 0 and <= MaximumRenderedPdfBytes)
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.None);
                var zeros = new byte[64 * 1024];
                long remaining = length;
                while (remaining > 0)
                {
                    var count = (int)Math.Min(zeros.Length, remaining);
                    stream.Write(zeros, 0, count);
                    remaining -= count;
                }
                stream.Flush(flushToDisk: true);
            }
            File.Delete(path);
        }
        catch
        {
            // Best effort only; encrypted transfer storage remains independently short-lived.
        }
    }
}
#else
namespace Paradiso.PrintCess.Infrastructure.Printing;

internal static class HancomHwpxRenderer
{
    public static bool IsAvailable => false;
}
#endif
