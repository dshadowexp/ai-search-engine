
-- 1. Dictionary of unique normalized terms

CREATE TABLE lexical_terms (
    term_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    term TEXT NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 2. Document-level lexical statistics

CREATE TABLE lexical_document_stats (
    document_version_id BIGINT PRIMARY KEY
        REFERENCES document_versions(id)
        ON DELETE CASCADE,

    document_length INTEGER NOT NULL,

    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 3. Inverted index / postings list

CREATE TABLE lexical_postings (
    term_id BIGINT NOT NULL
        REFERENCES lexical_terms(term_id)
        ON DELETE CASCADE,

    document_version_id BIGINT NOT NULL
        REFERENCES document_versions(id)
        ON DELETE CASCADE,

    term_frequency INTEGER NOT NULL,

    positions INTEGER[] NOT NULL DEFAULT '{}',

    PRIMARY KEY (term_id, document_version_id),

    CHECK (term_frequency > 0)
);


-- Find documents containing a term
CREATE INDEX idx_lexical_postings_term
ON lexical_postings(term_id);


-- Find all terms belonging to a document
CREATE INDEX idx_lexical_postings_document
ON lexical_postings(document_version_id);
