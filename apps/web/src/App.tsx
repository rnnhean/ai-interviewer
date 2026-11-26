import { Navigate, Route, Routes } from 'react-router-dom';
import { SetupPage } from './pages/SetupPage';
import { InterviewPage } from './pages/InterviewPage';
import { ReportPage } from './pages/ReportPage';

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<SetupPage />} />
      <Route path="/interview/:id" element={<InterviewPage />} />
      <Route path="/report/:id" element={<ReportPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
