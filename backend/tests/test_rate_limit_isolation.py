"""Test-client isolation does not bypass or raise the real application limit."""


def test_application_still_denies_request_121_from_the_same_client(test_client):
    for number in range(120):
        response = test_client.get("/health")
        assert response.status_code == 200
        assert response.headers["X-RateLimit-Limit"] == "120"
        assert response.headers["X-RateLimit-Remaining"] == str(119 - number)
    denied = test_client.get("/health")
    assert denied.status_code == 429
    assert denied.headers["Retry-After"] == "60"
    assert denied.headers["X-RateLimit-Limit"] == "120"
