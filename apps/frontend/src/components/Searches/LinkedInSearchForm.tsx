import { useState, type Dispatch, type SetStateAction } from 'react';

import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Stack from 'react-bootstrap/Stack';

import {
  linkedInDistanceOptions,
  linkedInExperienceOptions,
  linkedInWorkplaceOptions,
  type LinkedInExperienceLevel,
  type LinkedInGeoHit,
  type LinkedInSearchDraft,
  type LinkedInWorkplaceType,
} from '../../models/search';

function toggleExperienceLevel(
  draft: LinkedInSearchDraft,
  level: LinkedInExperienceLevel,
  checked: boolean,
): LinkedInExperienceLevel[] {
  if (checked) {
    return Array.from(new Set([...draft.experienceLevels, level]));
  }

  return draft.experienceLevels.filter((item) => item !== level);
}

function toggleWorkplaceType(
  draft: LinkedInSearchDraft,
  type: LinkedInWorkplaceType,
  checked: boolean,
): LinkedInWorkplaceType[] {
  if (checked) {
    return Array.from(new Set([...draft.workplaceTypes, type]));
  }

  return draft.workplaceTypes.filter((item) => item !== type);
}

/** Provider-specific body of the search wizard: the LinkedIn query fields. */
export function LinkedInSearchForm({
  draft,
  geoError,
  geoHits,
  setDraft,
}: {
  draft: LinkedInSearchDraft;
  geoError: string | null;
  geoHits: LinkedInGeoHit[];
  setDraft: Dispatch<SetStateAction<LinkedInSearchDraft>>;
}) {
  const [geoOpen, setGeoOpen] = useState(false);

  return (
    <div className="row g-4">
      <Form.Group className="col-12" controlId="linkedin-search-keywords">
        <Form.Label>Keyword</Form.Label>
        <Form.Control
          onChange={(event) => setDraft((current) => ({ ...current, keywords: event.target.value }))}
          placeholder="React TypeScript"
          value={draft.keywords}
        />
        <Form.Check
          checked={draft.exactMatch}
          className="mt-2"
          id="linkedin-exact"
          label="Cerca la frase esatta"
          onChange={(event) =>
            setDraft((current) => ({ ...current, exactMatch: event.target.checked }))
          }
          type="checkbox"
        />
      </Form.Group>

      <Form.Group className="col-12 position-relative" controlId="linkedin-location">
        <Form.Label>Localita</Form.Label>
        <Form.Control
          autoComplete="off"
          onBlur={() => window.setTimeout(() => setGeoOpen(false), 150)}
          onChange={(event) => {
            setGeoOpen(true);
            setDraft((current) => ({ ...current, geoId: '', location: event.target.value }));
          }}
          placeholder="Italy"
          value={draft.location}
        />
        {draft.geoId ? (
          <Form.Text className="text-secondary">
            geoId <span className="font-mono">{draft.geoId}</span>
          </Form.Text>
        ) : (
          <Form.Text className="text-secondary">
            Scegli un suggerimento per agganciare la localita esatta.
          </Form.Text>
        )}
        {geoOpen && geoHits.length > 0 ? (
          <ListGroup className="search-typeahead mt-1">
            {geoHits.map((hit) => (
              <ListGroup.Item
                key={hit.geoId}
                action
                onMouseDown={(event) => {
                  event.preventDefault();
                  setGeoOpen(false);
                  setDraft((current) => ({
                    ...current,
                    geoId: hit.geoId,
                    location: hit.displayName,
                  }));
                }}
              >
                <Stack direction="horizontal" className="justify-content-between gap-3">
                  <span>{hit.displayName}</span>
                  <Badge bg="secondary" className="font-mono">
                    {hit.geoId}
                  </Badge>
                </Stack>
              </ListGroup.Item>
            ))}
          </ListGroup>
        ) : null}
      </Form.Group>
      {geoError ? (
        <div className="col-12">
          <Alert className="mb-0" variant="warning">
            {geoError}
          </Alert>
        </div>
      ) : null}

      <Form.Group className="col-md-5" controlId="linkedin-distance">
        <Form.Label>Distanza</Form.Label>
        <Form.Select
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              distance: event.target.value as LinkedInSearchDraft['distance'],
            }))
          }
          value={draft.distance}
        >
          {linkedInDistanceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Form.Select>
      </Form.Group>

      <Form.Group className="col-12" controlId="linkedin-experience">
        <Form.Label>Esperienza</Form.Label>
        <Stack direction="horizontal" className="flex-wrap column-gap-4 row-gap-2">
          {linkedInExperienceOptions.map((option) => (
            <Form.Check
              key={option.value}
              checked={draft.experienceLevels.includes(option.value)}
              id={`linkedin-experience-${option.value}`}
              label={option.label}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  experienceLevels: toggleExperienceLevel(current, option.value, event.target.checked),
                }))
              }
              type="checkbox"
            />
          ))}
        </Stack>
      </Form.Group>

      <Form.Group className="col-12" controlId="linkedin-workplace">
        <Form.Label>Modalita lavoro</Form.Label>
        <Stack direction="horizontal" className="flex-wrap column-gap-4 row-gap-2">
          {linkedInWorkplaceOptions.map((option) => (
            <Form.Check
              key={option.value}
              checked={draft.workplaceTypes.includes(option.value)}
              id={`linkedin-workplace-${option.value}`}
              label={option.label}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  workplaceTypes: toggleWorkplaceType(current, option.value, event.target.checked),
                }))
              }
              type="checkbox"
            />
          ))}
        </Stack>
      </Form.Group>
    </div>
  );
}
