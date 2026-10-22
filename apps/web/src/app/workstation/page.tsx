import { redirect } from "next/navigation";

// Legacy workstation bookmarks open the actual public landing page, not the help screen.
export default function WorkstationPage() {
  redirect("/");
}
