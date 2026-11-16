from sentence_transformers import SentenceTransformer

class EmbeddingModel:

    def __init__(self):
        self.model = SentenceTransformer(
            "BAAI/bge-small-en-v1.5"
        )

    def encode_documents(self, texts: list[str]):
        return self.model.encode(
            texts,
            normalize_embeddings=True,
            batch_size=32
        )

    def encode_query(self, query: str):
        return self.model.encode(
            query,
            normalize_embeddings=True
        )