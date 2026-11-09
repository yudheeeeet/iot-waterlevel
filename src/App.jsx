import Header from './components/Header';
import SummaryCards from './components/SummaryCards';
import DeviceMap from './components/map/DeviceMap';
import CurrentReading from './components/CurrentReading';
import { TodayWeather, ForecastWeek } from './components/Weather';
import WaterLevelTrend from './components/WaterLevelTrend';
import Footer from './components/Footer';
import { useMonitoring } from './hooks/useMonitoring';
import { useWeather } from './hooks/useWeather';

export default function App() {
  const m = useMonitoring();
  const w = useWeather();

  return (
    <div className="app">
      <Header devices={m.devices} summary={m.summary} lastUpdate={m.lastUpdate} realtimeState={m.realtimeState} />

      <main className="dashboard">
        {m.error && (
          <div className="banner banner--error">
            {m.error} <button type="button" onClick={m.reload}>Retry</button>
          </div>
        )}

        <SummaryCards summary={m.summary} selectedDevice={m.selectedDevice} weather={w.weather} loading={m.loading} />

        <div className="row row--monitoring">
          <DeviceMap
            devices={m.devices}
            selectedId={m.selectedId}
            onSelect={m.setSelectedId}
            onAdd={m.addDevice}
            onUpdate={m.updateDevice}
            onRemove={m.removeDevice}
          />
          <CurrentReading device={m.selectedDevice} />
        </div>

        <div className="row row--weather">
          <TodayWeather weather={w.weather} loading={w.loading} error={w.error} onRetry={w.reload} />
          <ForecastWeek weather={w.weather} loading={w.loading} error={w.error} onRetry={w.reload} />
        </div>

        <WaterLevelTrend
          devices={m.devices}
          selectedId={m.selectedId}
          onSelectDevice={m.setSelectedId}
          lastReading={m.lastReading}
        />

        <Footer weatherSources={w.weather?.sources} />
      </main>
    </div>
  );
}
