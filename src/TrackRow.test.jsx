import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackRow } from './TrackRow';

const track = {
  filePath: '/tmp/a.mp3',
  title: 'Digital Love', artist: 'Daft Punk',
  album: 'Discovery', year: 2001,
  duration: 125, lyrics: 'some lyrics',
  dateAdded: 1700000000000, playCount: 42, lastPlayed: null,
  thumb: null,
};

function renderRow(over = {}) {
  const props = {
    track, index: 4,
    isCurrent: false, isPlaying: false, isSelected: false,
    density: 'compact', sortField: 'manual', leading: 'index',
    onRowClick: vi.fn(), onRowDoubleClick: vi.fn(), onPlayToggle: vi.fn(), onRowMenu: vi.fn(),
    ...over,
  };
  const utils = render(<TrackRow {...props} />);
  return { ...utils, props };
}

describe('TrackRow', () => {
  it('renders title primary and artist secondary by default', () => {
    renderRow();
    const title = screen.getByText('Digital Love');
    const artist = screen.getByText('Daft Punk');
    expect(title).toBeInTheDocument();
    // primary line is the bold one (getByText returns the styled line div)
    expect(title).toHaveStyle({ fontWeight: 600 });
    expect(artist).not.toHaveStyle({ fontWeight: 600 });
  });

  it('flips emphasis when sorted by artist', () => {
    renderRow({ sortField: 'artist' });
    expect(screen.getByText('Daft Punk')).toHaveStyle({ fontWeight: 600 });
    expect(screen.getByText('Digital Love')).not.toHaveStyle({ fontWeight: 600 });
  });

  it('keeps album primary — year is no longer a sortable field', () => {
    renderRow({ sortField: 'album' });
    expect(screen.getByText('Discovery')).toHaveStyle({ fontWeight: 600 });
    expect(screen.getByText('2001')).not.toHaveStyle({ fontWeight: 600 });
  });

  it('shows a 1-based index in the leading cell', () => {
    renderRow();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders no contextual trailing column for any sort', () => {
    renderRow({ sortField: 'title' });
    expect(screen.queryByText(/plays?$/)).not.toBeInTheDocument();
    expect(screen.queryByText('never')).not.toBeInTheDocument();
  });

  it('formats duration', () => {
    renderRow();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('row click reports track, index and the event', () => {
    const { props } = renderRow();
    fireEvent.click(screen.getByText('Digital Love'));
    expect(props.onRowClick).toHaveBeenCalledTimes(1);
    expect(props.onRowClick.mock.calls[0][0]).toBe(track);
    expect(props.onRowClick.mock.calls[0][1]).toBe(4);
  });

  it('double-click plays', () => {
    const { props } = renderRow();
    fireEvent.doubleClick(screen.getByText('Digital Love'));
    expect(props.onRowDoubleClick).toHaveBeenCalledWith(track);
  });

  it('right-click opens the menu at the cursor', () => {
    const { props } = renderRow();
    fireEvent.mouseDown(screen.getByText('Digital Love'), { button: 2, clientX: 100, clientY: 200 });
    expect(props.onRowMenu).toHaveBeenCalledTimes(1);
    expect(props.onRowMenu.mock.calls[0][2]).toMatchObject({ left: 100, top: 200 });
  });

  it('applies active and selected classes', () => {
    const { container } = renderRow({ isCurrent: true, isSelected: true });
    const row = container.querySelector('.track-row');
    expect(row).toHaveClass('active');
    expect(row).toHaveClass('selected');
  });

  it('shows EQ bars while the current track plays (not hovered)', () => {
    const { container } = renderRow({ isCurrent: true, isPlaying: true });
    expect(container.querySelectorAll('.eq-bar').length).toBe(3);
  });

  it('artwork overlay click toggles play without selecting the row', () => {
    const { container, props } = renderRow({ isCurrent: true, isPlaying: true });
    const overlay = container.querySelectorAll('.eq-bar')[0].parentElement;
    fireEvent.click(overlay);
    expect(props.onPlayToggle).toHaveBeenCalledWith(track);
    expect(props.onRowClick).not.toHaveBeenCalled();
  });

  it('keeps the time cell width stable between rest and hover (no layout jump)', () => {
    const { container } = renderRow();
    const row = container.querySelector('.track-row');
    // duration span and menu button are both always mounted in the same cell
    expect(screen.getByText('2:05')).toBeInTheDocument();
    expect(row.querySelector('.track-menu-btn')).toBeInTheDocument();
  });
});
