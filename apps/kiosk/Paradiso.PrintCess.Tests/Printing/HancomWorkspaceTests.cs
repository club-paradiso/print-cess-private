using System.IO;
using Paradiso.PrintCess.Infrastructure.Printing;

namespace Paradiso.PrintCess.Tests.Printing;

public sealed class HancomWorkspaceTests
{
    [Fact]
    public void PurgeRemovesDocumentsLeftByAnEarlierRun()
    {
        var root = Path.Combine(Path.GetTempPath(), "PrintCessTest", Guid.NewGuid().ToString("N"));
        var abandoned = Path.Combine(root, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(abandoned);
        File.WriteAllBytes(Path.Combine(abandoned, "document.hwp"), [1, 2, 3]);
        try
        {
            HancomWorkspace.PurgeAbandoned(root);

            Assert.True(Directory.Exists(root));
            Assert.Empty(Directory.EnumerateFileSystemEntries(root));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void PurgeIgnoresAMissingWorkFolder() =>
        HancomWorkspace.PurgeAbandoned(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
}
