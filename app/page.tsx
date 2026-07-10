import { redirect } from "next/navigation";

/*
  The app opens on the Dashboard. This used to be the build-roadmap welcome page,
  which is no longer useful now that every screen on that roadmap is built.
*/
export default function HomePage() {
  redirect("/dashboard");
}
