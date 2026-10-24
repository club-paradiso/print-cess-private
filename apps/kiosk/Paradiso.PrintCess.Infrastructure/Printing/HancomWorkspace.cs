using System.IO;

namespace Paradiso.PrintCess.Infrastructure.Printing;

/// <summary>
/// A crash, power loss or forced restart during Hangul rendering leaves a
/// decrypted document in the work folder, because the renderer's own cleanup
/// never ran. The kiosk clears the folder on every start.
/// </summary>
public static class HancomWorkspace
{
    internal static string WorkRoot => Path.Combine(Path.GetTempPath(), "PrintCess");

    /// <summary>Removes every rendering folder left behind by an earlier run.</summary>
    public static void PurgeAbandoned() => PurgeAbandoned(WorkRoot);

    public static void PurgeAbandoned(string root)
    {
        if (!Directory.Exists(root))
        {
            return;
        }

        foreach (var directory in Directory.EnumerateDirectories(root))
        {
            try
            {
                Directory.Delete(directory, recursive: true);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // A folder still held open is retried on the next start.
            }
        }
    }
}
