import { DatabaseConfigPreview } from "./DatabaseConfigPreview";
import { GrowthChart } from "./GrowthChart";
import { OverviewStats } from "./OverviewStats";

const OverviewPage = () => {
  return (
    <div className="container mx-auto space-y-4 p-4 md:p-6">
      <OverviewStats />

      <GrowthChart />

      <DatabaseConfigPreview />
    </div>
  );
};

export default OverviewPage;
