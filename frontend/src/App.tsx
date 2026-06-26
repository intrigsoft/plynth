import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/session';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';
import { LoginScreen } from './workspace/LoginScreen';
import { ProjectsScreen } from './workspace/ProjectsScreen';
import { ProjectScreen } from './workspace/ProjectScreen';
import { DocumentScreen } from './workspace/DocumentScreen';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/" element={<RequireAuth><ProjectsScreen /></RequireAuth>} />
        <Route path="/p/:projectId" element={<RequireAuth><ProjectScreen /></RequireAuth>} />
        <Route path="/p/:projectId/d/:docId" element={<RequireAuth><DocumentScreen /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
