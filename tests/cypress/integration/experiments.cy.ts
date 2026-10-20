describe('Import tab on profile page', () => {
  beforeEach(() => {
    cy.login();
  });

  it('can import eln and csv files', () => {
    // first ELN
    cy.visit('/profile.php?tab=3');
    cy.get('#importSelectCategory').should('exist');
    cy.get('#importSelectOwner').should('exist');
    cy.get('#importModalCanread').should('exist');
    cy.get('#importModalCanwrite').should('exist');
    // check if custom button exists and make form input visible
    cy.get('[data-action="show-file-input"]').should('exist').click();
    cy.get('#importFileInput').should('exist').selectFile('tests/_data/multiple-experiments.eln', { force: true });
    // Check that the file name is displayed
    cy.get('#fileName').should('be.visible').and('have.text','multiple-experiments.eln');
    cy.get('#importFileBtn').should('exist').click();
    cy.get('.overlay').first().should('be.visible').should('contain', 'File imported successfully');
    // now CSV
    cy.get('[data-action="show-file-input"]').should('exist').click();
    cy.get('#importFileInput').should('exist').selectFile('tests/_data/importable.csv', { force: true });
    cy.get('#fileName').should('be.visible').and('have.text','importable.csv');
    cy.get('#importFileBtn').click();
    cy.get('.overlay').first().should('be.visible').should('contain', 'File imported successfully');
  });

  it('can import multiple eln files', () => {
    cy.visit('/profile.php?tab=3');
    cy.get('[data-action="show-file-input"]').should('exist').click();
    cy.get('#importFileInput').should('exist').selectFile([
      'tests/_data/single-experiment.eln',
      'tests/_data/version-106.eln',
    ], { force: true });
    cy.get('#fileName').should('be.visible').and('contain', 'single-experiment.eln').and('contain', 'version-106.eln');
    cy.get('#importFileBtn').should('exist').click();
    cy.get('.overlay').first().should('be.visible').should('contain', 'File imported successfully');
  });

  it('rejects mixing .eln and .csv files', () => {
    cy.visit('/profile.php?tab=3');
    cy.get('[data-action="show-file-input"]').should('exist').click();
    cy.get('#importFileInput').should('exist').selectFile([
      'tests/_data/single-experiment.eln',
      'tests/_data/importable.csv',
    ], { force: true });
    cy.get('.overlay').first().should('be.visible').should('contain', 'Cannot mix .eln and .csv files.');
    cy.get('#importOptionsDiv').should('have.attr', 'hidden');
  });
});
