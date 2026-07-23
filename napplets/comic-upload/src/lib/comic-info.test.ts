import { describe, expect, it } from 'vitest';
import { parseComicInfoXml } from './comic-info';

describe('parseComicInfoXml', () => {
  it('extracts common fields and splits multi-value fields', () => {
    const metadata = parseComicInfoXml(`<?xml version="1.0"?>
      <ComicInfo>
        <Series>Batman</Series>
        <Number>001</Number>
        <Title>I Am Gotham, Part One</Title>
        <Publisher>DC Comics</Publisher>
        <LanguageISO>en</LanguageISO>
        <Genre>Superhero, Action</Genre>
        <Writer>Tom King; Scott Snyder</Writer>
        <BlackAndWhite>No</BlackAndWhite>
      </ComicInfo>`);

    expect(metadata.Series).toEqual(['Batman']);
    expect(metadata.Number).toEqual(['001']);
    expect(metadata.Genre).toEqual(['Superhero', 'Action']);
    expect(metadata.Writer).toEqual(['Tom King', 'Scott Snyder']);
    expect(metadata.BlackAndWhite).toEqual(['No']);
  });
});
