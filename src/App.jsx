import Header from './components/Header';
import SummaryCards from './components/SummaryCards';
import DeviceMap from './components/map/DeviceMap';
import CurrentReading from './components/CurrentReading';
import { TodayWeather, ForecastWeek } from './components/Weather';
import WaterLevelTrend from './components/WaterLevelTrend';
import Footer from './components/Footer';
import Login from './components/Login';
import { useAuth } from './hooks/useAuth';
import { useMonitoring } from './hooks/useMonitoring';
import { useWeather } from './hooks/useWeather';

/** Every user must log in (PRD ID-1); the dashboard is mounted only with a session. */
export default function App() {
  const auth = useAuth();
  if (!auth.ready) return <div className="login-page"><p className="muted">Loading…</p></div>;
  if (!auth.user) return <Login />;
  return <Dashboard auth={auth} />;
}

function Dashboard({ auth }) {
  const m = useMonitoring();
  const w = useWeather();

  return (
    <div className="app">
      <Header
        devices={m.devices}
        summary={m.summary}
        lastUpdate={m.lastUpdate}
        realtimeState={m.realtimeState}
        user={auth.user}
        onLogout={auth.logout}
      />

      <main className="dashboard">
        {m.error && (
          <div className="banner banner--error">
            {m.error} <button type="button" onClick={m.reload}>Retry</button>
          </div>
        )}

        <SummaryCards summary={m.summary} weather={w.weather} loading={m.loading} />

        <div className="row row--monitoring">
          <DeviceMap
            devices={m.devices}
            selectedId={m.selectedId}
            onSelect={m.setSelectedId}
            onAdd={m.addDevice}
            onUpdate={m.updateDevice}
            onRemove={m.removeDevice}
            onRotate={m.rotateToken}
            canEdit={auth.isAdmin}
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
