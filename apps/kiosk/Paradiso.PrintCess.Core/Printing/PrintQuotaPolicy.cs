namespace Paradiso.PrintCess.Core.Printing;

public enum PrintQuotaDecision
{
    Allowed,
    StaffOverrideRequired,
    HardLimitExceeded,
}

/// <summary>
/// Keeps the public courtesy limit separate from the machine's technical ceiling.
/// The policy is deliberately duplicated in the native trust boundary: values sent
/// by the browser are informative only and never authorize a print.
/// </summary>
public static class PrintQuotaPolicy
{
    public const int PublicFreePageLimit = 11;
    public const int SystemPageLimit = 50;

    public static PrintQuotaDecision Decide(int renderedPageCount, bool staffAuthorized = false)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(renderedPageCount, 1);
        if (renderedPageCount > SystemPageLimit)
        {
            return PrintQuotaDecision.HardLimitExceeded;
        }

        if (renderedPageCount > PublicFreePageLimit && !staffAuthorized)
        {
            return PrintQuotaDecision.StaffOverrideRequired;
        }

        return PrintQuotaDecision.Allowed;
    }
}
