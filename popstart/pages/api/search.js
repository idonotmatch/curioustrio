// pages/api/search.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).end(); // Method Not Allowed
    }
  
    const { searchTerm } = req.body;
  
    try {
      const response = await fetch('https://graphql.canopyapi.co/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.API_KEY}`, // Ensure this is correctly set
        },
        body: JSON.stringify({
            query: `
            query MyQuery($searchTerm: String!) {
              amazonProductSearchResults(input: {searchTerm: $searchTerm}) {
                productResults {
                  results {
                    asin
                    bestSellerRankings {
                      categoryName
                      rank
                    }
                    brand
                    countryOfOrigin
                    featureBullets
                    imageUrls
                    price {
                      currency
                      value
                    }
                    rating
                    ratingsBreakdown {
                      fiveStarRatingsCount
                      fourStarRatingsCount
                      threeStarRatingsCount
                      twoStarRatingsCount
                      oneStarRatingsCount
                    }
                    ratingsTotal
                    title
                    url
                  }
                }
              }
            }
          `,
          variables: { searchTerm },
        }),
      });
  
      if (!response.ok) {
        // If the response is not ok, we are throwing an error with the status code
        throw new Error(`API call failed with status: ${response.status}`);
      }
  
      const data = await response.json();
      return res.status(200).json(data);
    } catch (error) {
      console.error('Search API error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  