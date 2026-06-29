import { Link, useLocation } from 'react-router-dom';

import {
  Activity,
  BriefcaseBusiness,
  Gauge,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import Container from 'react-bootstrap/Container';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';

import { ActivityNavStatus } from '../Activities/ActivityNavStatus';

const navItems = [
  { icon: Gauge, label: 'Dashboard', to: '/' },
  { icon: BriefcaseBusiness, label: 'Offerte', to: '/jobs' },
  { icon: Search, label: 'Ricerche', to: '/searches' },
  { icon: Activity, label: 'Attivita', to: '/activities' },
  { icon: Settings, label: 'Impostazioni', to: '/settings' },
];

function isActivePath(currentPath: string, itemPath: string): boolean {
  return itemPath === '/' ? currentPath === '/' : currentPath.startsWith(itemPath);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="app-shell">
      <Navbar className="app-navbar" expand="lg" sticky="top">
        <Container fluid className="app-container">
          <Navbar.Brand as={Link} className="app-brand" to="/">
            <span className="app-brand-mark">JL</span>
            <span>JobLens</span>
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="main-navigation" />
          <Navbar.Collapse id="main-navigation">
            <Nav className="app-nav me-auto py-2 py-lg-0">
              {navItems.map((item) => {
                const Icon: LucideIcon = item.icon;

                return (
                  <Nav.Link
                    key={item.to}
                    active={isActivePath(location.pathname, item.to)}
                    as={Link}
                    className="app-nav-link"
                    to={item.to}
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={2} />
                    <span>{item.label}</span>
                  </Nav.Link>
                );
              })}
            </Nav>
            <div className="d-flex align-items-center py-2 py-lg-0">
              <ActivityNavStatus />
            </div>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <main className="app-main">
        <Container fluid className="app-container app-content-container">
          {children}
        </Container>
      </main>
    </div>
  );
}
