import { forwardRef, useEffect, useState, type ComponentPropsWithoutRef } from 'react';

import { ChevronDown, Search as SearchIcon, Sparkles } from 'lucide-react';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import InputGroup from 'react-bootstrap/InputGroup';
import Stack from 'react-bootstrap/Stack';

import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  getJobDecisionVariant,
  jobAvailabilityStatusOptions,
  jobLocalStatusOptions,
  jobReviewDecisionFilterOptions,
  jobWorkplaceModeOptions,
  type JobFilters,
  type JobReviewDecisionFilter,
} from '../../models/job';
import type { Search } from '../../models/search';

function normalizeInput(value: string): string {
  return value.trim();
}

function optionLabel(options: ReadonlyArray<{ label: string; value: string }>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

// Pill-style toggle used by every filter dropdown. Filled when the filter is active.
const PillToggle = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { active?: boolean }
>(function PillToggle({ active = false, children, className, ...rest }, ref) {
  return (
    <button
      {...rest}
      className={[
        'jl-filter-pill d-inline-flex align-items-center gap-1 rounded-pill border px-3 py-1 small fw-medium',
        active
          ? 'border-primary bg-primary-subtle text-primary-emphasis'
          : 'border-secondary-subtle text-secondary',
        className ?? '',
      ].join(' ')}
      ref={ref}
      type="button"
    >
      {children}
      <ChevronDown aria-hidden="true" size={14} />
    </button>
  );
});

function FilterPill({
  active,
  children,
  label,
  menuWidth = '15rem',
  staysOpen = false,
}: {
  active: boolean;
  children: React.ReactNode;
  label: string;
  menuWidth?: string;
  staysOpen?: boolean;
}) {
  return (
    <Dropdown autoClose={staysOpen ? 'outside' : true}>
      <Dropdown.Toggle active={active} as={PillToggle}>
        {label}
      </Dropdown.Toggle>
      <Dropdown.Menu className="shadow-sm" renderOnMount style={{ minWidth: menuWidth }}>
        {children}
      </Dropdown.Menu>
    </Dropdown>
  );
}

export function JobFilterBar({
  batchReviewDisabled,
  batchReviewing,
  filters,
  loading,
  onBatchReview,
  onChange,
  onRefresh,
  searches,
  total,
}: {
  batchReviewDisabled: boolean;
  batchReviewing: boolean;
  filters: JobFilters;
  loading: boolean;
  onBatchReview: () => void;
  onChange: (filters: Partial<JobFilters>) => void;
  onRefresh: () => void;
  searches: Search[];
  total: number;
}) {
  const [text, setText] = useState(filters.text);
  const [location, setLocation] = useState(filters.location);
  const [modelName, setModelName] = useState(filters.modelName);
  const debouncedText = useDebouncedValue(text, 350);
  const debouncedLocation = useDebouncedValue(location, 350);
  const debouncedModelName = useDebouncedValue(modelName, 350);

  useEffect(() => {
    if (debouncedText !== filters.text) {
      onChange({ text: normalizeInput(debouncedText) });
    }
  }, [debouncedText, filters.text, onChange]);

  useEffect(() => {
    if (debouncedLocation !== filters.location) {
      onChange({ location: normalizeInput(debouncedLocation) });
    }
  }, [debouncedLocation, filters.location, onChange]);

  useEffect(() => {
    if (debouncedModelName !== filters.modelName) {
      onChange({ modelName: normalizeInput(debouncedModelName) });
    }
  }, [debouncedModelName, filters.modelName, onChange]);

  useEffect(() => {
    setText(filters.text);
    setLocation(filters.location);
    setModelName(filters.modelName);
  }, [filters.location, filters.modelName, filters.text]);

  const decisionVariant = (value: JobReviewDecisionFilter) =>
    value === 'none' ? 'secondary' : getJobDecisionVariant(value);

  const toggleDecision = (value: JobReviewDecisionFilter) => {
    const selected = new Set(filters.decision);
    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }
    onChange({
      decision: jobReviewDecisionFilterOptions
        .map((option) => option.value)
        .filter((decision) => selected.has(decision)),
    });
  };

  const clearAll = () => {
    setText('');
    setLocation('');
    setModelName('');
    onChange({
      availabilityStatus: '',
      decision: [],
      localStatus: '',
      location: '',
      modelName: '',
      providerKey: '',
      scope: 'standard',
      searchId: '',
      text: '',
      workplace: '',
    });
  };

  const decisionCount = filters.decision.length;
  const decisionLabel =
    decisionCount === 0
      ? 'Decisione AI'
      : `Decisione: ${optionLabel(jobReviewDecisionFilterOptions, filters.decision[0] ?? '')}${
          decisionCount > 1 ? ` +${decisionCount - 1}` : ''
        }`;

  const advancedActive =
    (filters.searchId ? 1 : 0) +
    (filters.providerKey ? 1 : 0) +
    (filters.modelName ? 1 : 0) +
    (filters.scope !== 'standard' ? 1 : 0);

  const anyActive =
    decisionCount > 0 ||
    Boolean(filters.localStatus) ||
    Boolean(filters.workplace) ||
    Boolean(filters.availabilityStatus) ||
    Boolean(filters.location) ||
    Boolean(filters.text) ||
    advancedActive > 0;

  const searchName = searches.find((search) => search.id === filters.searchId)?.name;

  return (
    <Card>
      <Card.Body>
        <Stack className="gap-3">
          {/* Search + sort + actions */}
          <div className="d-flex flex-wrap align-items-center gap-2">
            <InputGroup style={{ flex: '1 1 22rem', minWidth: '14rem', width: 'auto' }}>
              <InputGroup.Text>
                <SearchIcon aria-hidden="true" size={16} />
              </InputGroup.Text>
              <Form.Control
                aria-label="Cerca offerte"
                onChange={(event) => setText(event.target.value)}
                placeholder="Cerca titolo, azienda, external ID"
                value={text}
              />
            </InputGroup>

            <Form.Select
              aria-label="Ordina offerte"
              onChange={(event) => {
                const [sortBy, sortDir] = event.target.value.split(':');
                onChange({
                  sortBy: sortBy as JobFilters['sortBy'],
                  sortDir: sortDir as JobFilters['sortDir'],
                });
              }}
              style={{ width: 'auto' }}
              value={`${filters.sortBy}:${filters.sortDir}`}
            >
              <option value="aiScore:desc">Score AI alto</option>
              <option value="aiScore:asc">Score AI basso</option>
              <option value="publishedAt:desc">Pubblicazione recente</option>
              <option value="publishedAt:asc">Pubblicazione vecchia</option>
              <option value="repostedAt:desc">Ripubblicazione recente</option>
              <option value="repostedAt:asc">Ripubblicazione vecchia</option>
            </Form.Select>

            <div className="d-flex flex-wrap gap-2 ms-auto">
              <Button
                className="d-inline-flex align-items-center gap-2"
                disabled={batchReviewDisabled || batchReviewing || loading}
                onClick={onBatchReview}
                variant="outline-success"
              >
                <Sparkles aria-hidden="true" size={16} />
                {batchReviewing ? 'Review in coda...' : 'Review AI batch'}
              </Button>
              <Button disabled={loading} onClick={onRefresh} variant="outline-primary">
                Aggiorna
              </Button>
            </div>
          </div>

          {/* Filter pills */}
          <div className="d-flex flex-wrap align-items-center gap-2">
            <FilterPill active={decisionCount > 0} label={decisionLabel} staysOpen>
              <div className="px-2 pb-1 form-eyebrow">Decisione AI</div>
              {jobReviewDecisionFilterOptions.map((option) => (
                <button
                  aria-pressed={filters.decision.includes(option.value)}
                  className={[
                    'job-decision-filter-option',
                    `job-decision-filter-option-${decisionVariant(option.value)}`,
                    filters.decision.includes(option.value) ? 'is-active' : '',
                  ].join(' ')}
                  key={option.value}
                  onClick={() => toggleDecision(option.value)}
                  type="button"
                >
                  <span
                    className={`d-inline-block rounded-circle bg-${decisionVariant(option.value)}`}
                    style={{ height: 8, width: 8 }}
                  />
                  <span>{option.label}</span>
                </button>
              ))}
            </FilterPill>

            <FilterPill
              active={Boolean(filters.localStatus)}
              label={filters.localStatus ? `Stato: ${optionLabel(jobLocalStatusOptions, filters.localStatus)}` : 'Stato locale'}
            >
              <Dropdown.Item active={!filters.localStatus} onClick={() => onChange({ localStatus: '' })}>
                Tutti
              </Dropdown.Item>
              {jobLocalStatusOptions.map((option) => (
                <Dropdown.Item
                  active={filters.localStatus === option.value}
                  key={option.value}
                  onClick={() => onChange({ localStatus: option.value })}
                >
                  {option.label}
                </Dropdown.Item>
              ))}
            </FilterPill>

            <FilterPill
              active={Boolean(filters.workplace)}
              label={filters.workplace ? `Modalita: ${optionLabel(jobWorkplaceModeOptions, filters.workplace)}` : 'Modalita'}
            >
              <Dropdown.Item active={!filters.workplace} onClick={() => onChange({ workplace: '' })}>
                Tutte
              </Dropdown.Item>
              {jobWorkplaceModeOptions.map((option) => (
                <Dropdown.Item
                  active={filters.workplace === option.value}
                  key={option.value}
                  onClick={() => onChange({ workplace: option.value })}
                >
                  {option.label}
                </Dropdown.Item>
              ))}
            </FilterPill>

            <FilterPill
              active={Boolean(filters.location)}
              label={filters.location ? `Localita: ${filters.location}` : 'Localita'}
              staysOpen
            >
              <div className="px-2">
                <Form.Label className="form-eyebrow mb-1">Localita</Form.Label>
                <Form.Control
                  autoFocus
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Es. Milano, remoto"
                  size="sm"
                  value={location}
                />
                {location ? (
                  <Button
                    className="px-0 mt-1"
                    onClick={() => setLocation('')}
                    size="sm"
                    variant="link"
                  >
                    Pulisci
                  </Button>
                ) : null}
              </div>
            </FilterPill>

            <FilterPill
              active={Boolean(filters.availabilityStatus)}
              label={
                filters.availabilityStatus
                  ? `Disponibilita: ${optionLabel(jobAvailabilityStatusOptions, filters.availabilityStatus)}`
                  : 'Disponibilita'
              }
            >
              <Dropdown.Item
                active={!filters.availabilityStatus}
                onClick={() => onChange({ availabilityStatus: '' })}
              >
                Tutte
              </Dropdown.Item>
              {jobAvailabilityStatusOptions.map((option) => (
                <Dropdown.Item
                  active={filters.availabilityStatus === option.value}
                  key={option.value}
                  onClick={() => onChange({ availabilityStatus: option.value })}
                >
                  {option.label}
                </Dropdown.Item>
              ))}
            </FilterPill>

            <FilterPill
              active={advancedActive > 0}
              label={advancedActive > 0 ? `Altri · ${advancedActive}` : 'Altri'}
              menuWidth="18rem"
              staysOpen
            >
              <Stack className="gap-3 px-2 py-1">
                <Form.Group controlId="jobs-search-filter">
                  <Form.Label className="form-eyebrow mb-1">Ricerca</Form.Label>
                  <Form.Select
                    onChange={(event) => onChange({ searchId: event.target.value })}
                    size="sm"
                    value={filters.searchId}
                  >
                    <option value="">Tutte le ricerche</option>
                    {searches.map((search) => (
                      <option key={search.id} value={search.id}>
                        {search.name}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>

                <Form.Group controlId="jobs-provider-filter">
                  <Form.Label className="form-eyebrow mb-1">Provider</Form.Label>
                  <Form.Select
                    onChange={(event) =>
                      onChange({ providerKey: event.target.value === 'linkedin' ? 'linkedin' : '' })
                    }
                    size="sm"
                    value={filters.providerKey}
                  >
                    <option value="">Tutti</option>
                    <option value="linkedin">LinkedIn</option>
                  </Form.Select>
                </Form.Group>

                <Form.Group controlId="jobs-model-filter">
                  <Form.Label className="form-eyebrow mb-1">Modello</Form.Label>
                  <Form.Control
                    onChange={(event) => setModelName(event.target.value)}
                    placeholder="Nome modello"
                    size="sm"
                    value={modelName}
                  />
                </Form.Group>

                <Form.Group controlId="jobs-scope-filter">
                  <Form.Label className="form-eyebrow mb-1">Vista</Form.Label>
                  <Form.Select
                    onChange={(event) => onChange({ scope: event.target.value as JobFilters['scope'] })}
                    size="sm"
                    value={filters.scope}
                  >
                    <option value="standard">Standard</option>
                    <option value="all">Tutte</option>
                  </Form.Select>
                </Form.Group>
              </Stack>
            </FilterPill>

            <div className="d-flex align-items-center gap-3 ms-auto">
              <span className="small text-secondary font-mono">
                {total} {total === 1 ? 'offerta' : 'offerte'}
              </span>
              {anyActive ? (
                <Button className="p-0 text-secondary" onClick={clearAll} size="sm" variant="link">
                  Azzera
                </Button>
              ) : null}
            </div>
          </div>
          {filters.searchId && searchName ? (
            <div className="small text-secondary">Ricerca attiva: {searchName}</div>
          ) : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}
