export function formatTime(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = days[date.getDay()];
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hours24 = date.getHours();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const hh = String(hours12).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dayOfWeek}, ${yyyy}-${mm}-${dd} ${hh}:${min} ${period}`;
}
