import { redirect } from "next/navigation";

// Keep legacy links working while routing every device to the same set of tools.
export default function WorkstationPage() {
  redirect("/start#environment");
}
