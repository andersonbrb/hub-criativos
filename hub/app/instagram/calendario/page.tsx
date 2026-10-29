import type { Metadata } from "next";

import { CalendarView } from "@/features/instagram/tela/calendar/components/calendar-view";

export const metadata: Metadata = { title: "Calendário" };

export default function InstagramCalendarioPage() {
  return <CalendarView />;
}
