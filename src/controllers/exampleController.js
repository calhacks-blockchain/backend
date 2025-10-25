const getExample = (req, res) => {
    res.json({ data: 'This is an example response from the backend' });
};

export default { getExample };