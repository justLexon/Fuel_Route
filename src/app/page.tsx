import DashboardHeader from "@/components/DashboardHeader";
import LocationSection from "@/components/LocationSection";
import styles from "@/components/Dashboard.module.css";

export default function Home() {
  return (
    <main className={styles.dashboard}>
      <div className={styles.shell}>
        <DashboardHeader />
        <LocationSection />
      </div>
    </main>
  );
}
