namespace Paradiso.PrintCess.Core.Printing;

public enum PrintQuotaDecision
{
    Allowed,
    StaffOverrideRequired,
    HardLimitExceeded,
}

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
